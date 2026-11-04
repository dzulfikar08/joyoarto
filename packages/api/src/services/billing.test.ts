import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import type { Principal } from "../context";
import { billingConfig } from "../lib/billing/config";
import type { BillingConfig } from "../lib/billing/config";
import { WEBHOOK_TARGET, requestTimestamp, signRequest } from "../lib/billing/doku";
import { PAST_DUE_GRACE_MS, addMonths, resolveEntitlement } from "../lib/billing/entitlement";
import type { EntitlementRow } from "../lib/billing/entitlement";
import { POLAR_SANDBOX_URL, signPolarWebhook, verifyPolarWebhook } from "../lib/billing/polar";
import { sampleGopayText, sampleJagoText } from "../lib/statements/sample";
import { testDb, testPrincipal } from "../test/d1";
import {
  assertMemberSeat,
  assertScenarioSlot,
  assertStatementImport,
  billingStatus,
  chatCap,
  checkoutInput,
  getOrder,
  householdPlan,
  requireFeature,
  startDokuCheckout,
} from "./billing";
import { handleDokuWebhook, handlePolarWebhook } from "./billing-webhooks";
import { createInvite } from "./household";
import { saveScenario } from "./scenarios";
import { importStatement } from "./statements";

const DAY = 86_400_000;
const DOKU = { clientId: "BRN-0001-0000000000001", secretKey: "SK-test-secret", baseUrl: "https://api-sandbox.doku.com", sandbox: true };
const POLAR_SECRET = `whsec_${btoa("polar-test-secret-bytes")}`;
const POLAR = {
  accessToken: "polar_oat_test",
  webhookSecret: POLAR_SECRET,
  baseUrl: POLAR_SANDBOX_URL,
  productIds: { monthly: "prod_monthly", yearly: "prod_yearly" },
  priceUsdCents: { monthly: 299, yearly: 2900 },
};

function config(over: Partial<BillingConfig> = {}): BillingConfig {
  return {
    enforced: true,
    priceIdr: { monthly: 29_000, yearly: 290_000 },
    founder: null,
    // No trial by default, so a fresh test household is on Free.
    trialDays: 0,
    grandfather: null,
    proEmails: [],
    doku: DOKU,
    polar: POLAR,
    appUrl: "https://app.test",
    apiUrl: "https://app.test",
    ...over,
  };
}

let db: Database;
let cfg: BillingConfig;

beforeEach(async () => {
  ({ db } = await testDb());
  cfg = config();
});

async function pendingOrder(p: Principal, opts: { id?: string; months?: number; amountIdr?: number; tier?: "standard" | "founder" } = {}) {
  const id = opts.id ?? `ART-261104000000-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(schema.billingOrder).values({
    id,
    householdId: p.householdId,
    userId: p.userId,
    provider: "doku",
    interval: opts.months === 12 ? "yearly" : "monthly",
    months: opts.months ?? 1,
    amount: (opts.amountIdr ?? 29_000) * 100,
    currency: "IDR",
    priceTier: opts.tier ?? "standard",
  });
  return id;
}

/** A DOKU notification signed like DOKU signs it (or with another key). */
async function dokuNotify(orderId: string, amountIdr: number, opts: { status?: string; secret?: string; now?: Date } = {}) {
  const body = JSON.stringify({ order: { invoice_number: orderId, amount: amountIdr }, transaction: { status: opts.status ?? "SUCCESS" } });
  const requestId = crypto.randomUUID();
  const timestamp = requestTimestamp();
  const signature = await signRequest({ clientId: DOKU.clientId, requestId, timestamp, target: WEBHOOK_TARGET, body }, opts.secret ?? DOKU.secretKey);
  const headers: Record<string, string> = { "Client-Id": DOKU.clientId, "Request-Id": requestId, "Request-Timestamp": timestamp, Signature: signature };
  return handleDokuWebhook(db, cfg, { header: (n) => headers[n], body }, opts.now ?? new Date());
}

async function entitlement(householdId: string, provider: "doku" | "polar") {
  const [row] = await db
    .select()
    .from(schema.householdEntitlement)
    .where(and(eq(schema.householdEntitlement.householdId, householdId), eq(schema.householdEntitlement.provider, provider)));
  return row;
}

async function order(id: string) {
  const [row] = await db.select().from(schema.billingOrder).where(eq(schema.billingOrder.id, id));
  return row;
}

/** Expects an upgrade prompt for `feature`. */
async function expectUpgrade(promise: Promise<unknown>, feature: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, { upgrade: boolean; feature: string }>).code).toBe("FORBIDDEN");
    expect((error as ORPCError<string, { upgrade: boolean; feature: string }>).data).toMatchObject({ upgrade: true, feature });
    return;
  }
  throw new Error(`expected an upgrade prompt for ${feature}`);
}

// ------------------------------------------------------------------------------------------------ plan resolution

describe("entitlement transitions", () => {
  const created = new Date("2026-11-10T00:00:00Z");
  const base = { config: { enforced: true, trialDays: 14, grandfather: null }, householdCreatedAt: created, granted: false };
  const row = (over: Partial<EntitlementRow>): EntitlementRow => ({ provider: "polar", status: "active", interval: "monthly", periodEnd: new Date("2026-12-24T00:00:00Z"), cancelAtPeriodEnd: false, ...over });

  test("trial -> active -> past_due (grace) -> canceled -> expired", () => {
    // Trial: no rows, inside 14 days.
    const trial = resolveEntitlement({ ...base, rows: [], now: new Date("2026-11-20T00:00:00Z") });
    expect(trial).toMatchObject({ plan: "pro", source: "trial", status: "trialing" });
    expect(trial.periodEnd?.toISOString()).toBe("2026-11-24T00:00:00.000Z");
    // Trial over, nothing bought: Free.
    expect(resolveEntitlement({ ...base, rows: [], now: new Date("2026-11-25T00:00:00Z") })).toMatchObject({ plan: "free", status: "free" });

    // Subscribed.
    const active = resolveEntitlement({ ...base, rows: [row({})], now: new Date("2026-11-25T00:00:00Z") });
    expect(active).toMatchObject({ plan: "pro", source: "subscription", status: "active", provider: "polar", cancelAtPeriodEnd: false });

    // Renewal failed: Pro during the grace period after the period end, then Free.
    const pastDue = row({ status: "past_due" });
    expect(resolveEntitlement({ ...base, rows: [pastDue], now: new Date("2026-12-26T00:00:00Z") })).toMatchObject({ plan: "pro", status: "past_due" });
    const afterGrace = new Date(pastDue.periodEnd!.getTime() + PAST_DUE_GRACE_MS + 1);
    expect(resolveEntitlement({ ...base, rows: [pastDue], now: afterGrace })).toMatchObject({ plan: "free", status: "past_due" });

    // Canceled: Pro until the period end, then Free.
    const canceled = row({ status: "canceled", cancelAtPeriodEnd: true });
    expect(resolveEntitlement({ ...base, rows: [canceled], now: new Date("2026-12-20T00:00:00Z") })).toMatchObject({ plan: "pro", status: "canceled", cancelAtPeriodEnd: true });
    expect(resolveEntitlement({ ...base, rows: [canceled], now: new Date("2026-12-25T00:00:00Z") })).toMatchObject({ plan: "free", status: "canceled" });

    // Revoked or ran out.
    expect(resolveEntitlement({ ...base, rows: [row({ status: "expired" })], now: new Date("2026-12-01T00:00:00Z") })).toMatchObject({ plan: "free", status: "expired" });
  });

  test("grandfathered households, the owner allow-list and self-hosts", () => {
    const grandfather = { createdBefore: new Date("2026-11-05T00:00:00+07:00"), until: new Date("2027-02-01T00:00:00+07:00") };
    const old = new Date("2026-06-01T00:00:00Z");
    const gf = resolveEntitlement({ ...base, config: { ...base.config, grandfather }, householdCreatedAt: old, rows: [], now: new Date("2027-01-15T00:00:00Z") });
    expect(gf).toMatchObject({ plan: "pro", source: "grandfather", status: "trialing" });
    expect(resolveEntitlement({ ...base, config: { ...base.config, grandfather }, householdCreatedAt: old, rows: [], now: new Date("2027-02-02T00:00:00Z") }).plan).toBe("free");
    // Created after the cutoff: the normal trial.
    expect(resolveEntitlement({ ...base, config: { ...base.config, grandfather }, rows: [], now: new Date("2026-11-20T00:00:00Z") }).source).toBe("trial");

    expect(resolveEntitlement({ ...base, granted: true, rows: [], now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ plan: "pro", source: "grant" });
    expect(resolveEntitlement({ ...base, config: { ...base.config, enforced: false }, rows: [], now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ plan: "pro", source: "selfhost" });
  });

  test("a renewing subscription is shown over prepaid time", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const doku = row({ provider: "doku", periodEnd: new Date("2027-03-01T00:00:00Z") });
    const polar = row({ provider: "polar", periodEnd: new Date("2026-12-24T00:00:00Z") });
    expect(resolveEntitlement({ ...base, rows: [doku, polar], now }).provider).toBe("polar");
  });

  test("addMonths clamps to the month's end", () => {
    expect(addMonths(new Date("2027-01-31T10:00:00Z"), 1).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-11-04T00:00:00Z"), 12).toISOString()).toBe("2027-11-04T00:00:00.000Z");
  });
});

describe("billing config", () => {
  const urls = { appUrl: "https://app.test/", apiUrl: "https://app.test" };

  test("limits apply only with PAYWALL=1 and a gateway; DOKU defaults to the sandbox", () => {
    expect(billingConfig({ PAYWALL: "1" }, urls).enforced).toBe(false);
    expect(billingConfig({ DOKU_CLIENT_ID: "a", DOKU_SECRET_KEY: "b" }, urls).enforced).toBe(false);
    const on = billingConfig({ PAYWALL: "1", DOKU_CLIENT_ID: "a", DOKU_SECRET_KEY: "b" }, urls);
    expect(on.enforced).toBe(true);
    expect(on.doku).toMatchObject({ baseUrl: "https://api-sandbox.doku.com", sandbox: true });
    expect(billingConfig({ DOKU_CLIENT_ID: "a", DOKU_SECRET_KEY: "b", DOKU_ENV: "production" }, urls).doku?.baseUrl).toBe("https://api.doku.com");
    expect(on.appUrl).toBe("https://app.test");
    expect(on.priceIdr).toEqual({ monthly: 29_000, yearly: 290_000 });
  });

  test("prices, founder offer, grandfather date and allow-list come from vars; typos are loud", () => {
    const c = billingConfig(
      { PRO_MONTHLY_IDR: "35000", PRO_FOUNDER_MONTHLY_IDR: "19000", PRO_GRANDFATHER_CREATED_BEFORE: "2026-11-05", PRO_GRANDFATHER_UNTIL: "2027-02-01", PRO_EMAILS: "A@x.com", ADMIN_EMAILS: "b@x.com" },
      urls,
    );
    expect(c.priceIdr).toEqual({ monthly: 35_000, yearly: 350_000 });
    expect(c.founder).toEqual({ priceIdr: { monthly: 19_000, yearly: 190_000 }, slots: 100 });
    expect(c.grandfather?.until.toISOString()).toBe("2027-01-31T17:00:00.000Z");
    expect(c.proEmails).toEqual(["a@x.com", "b@x.com"]);
    expect(() => billingConfig({ PRO_MONTHLY_IDR: "29.000" }, urls)).toThrow();
    expect(() => billingConfig({ PRO_GRANDFATHER_CREATED_BEFORE: "5 Nov", PRO_GRANDFATHER_UNTIL: "2027-02-01" }, urls)).toThrow();
  });

  test("the owner's household stays Pro through the allow-list", async () => {
    const owner = await testPrincipal(db, "Owner");
    const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, owner.userId));
    const other = await testPrincipal(db, "Other");
    const c = config({ proEmails: [u!.email.toUpperCase().toLowerCase()] });
    expect((await householdPlan(db, owner.householdId, c)).entitlement.source).toBe("grant");
    expect((await householdPlan(db, other.householdId, c)).entitlement.plan).toBe("free");
  });
});

// ------------------------------------------------------------------------------------------------ DOKU

describe("DOKU webhook", () => {
  test("a valid signature pays the order and gives the household a month of Pro", async () => {
    const p = await testPrincipal(db);
    const id = await pendingOrder(p);
    const now = new Date("2026-11-04T05:00:00Z");
    const res = await dokuNotify(id, 29_000, { now });
    expect(res).toEqual({ status: 200, body: { received: true, activated: true } });
    expect(await order(id)).toMatchObject({ status: "paid", paidAt: now });
    const row = await entitlement(p.householdId, "doku");
    expect(row).toMatchObject({ status: "active", interval: "monthly" });
    expect(row!.periodEnd!.toISOString()).toBe("2026-12-04T05:00:00.000Z");
    expect((await householdPlan(db, p.householdId, cfg, new Date("2026-11-20T00:00:00Z"))).entitlement).toMatchObject({ plan: "pro", provider: "doku" });
  });

  test("an invalid signature is refused and changes nothing", async () => {
    const p = await testPrincipal(db);
    const id = await pendingOrder(p);
    expect((await dokuNotify(id, 29_000, { secret: "SK-attacker" })).status).toBe(401);
    // Right key, tampered body: the digest no longer matches.
    const body = JSON.stringify({ order: { invoice_number: id, amount: 29_000 }, transaction: { status: "SUCCESS" } });
    const requestId = crypto.randomUUID();
    const timestamp = requestTimestamp();
    const signature = await signRequest({ clientId: DOKU.clientId, requestId, timestamp, target: WEBHOOK_TARGET, body }, DOKU.secretKey);
    const headers: Record<string, string> = { "Client-Id": DOKU.clientId, "Request-Id": requestId, "Request-Timestamp": timestamp, Signature: signature };
    const tampered = await handleDokuWebhook(db, cfg, { header: (n) => headers[n], body: body.replace("29000", "1") });
    expect(tampered.status).toBe(401);
    expect((await order(id))?.status).toBe("pending");
    expect(await entitlement(p.householdId, "doku")).toBeUndefined();
  });

  test("replaying a paid notification extends once", async () => {
    const p = await testPrincipal(db);
    const id = await pendingOrder(p);
    await dokuNotify(id, 29_000);
    const first = (await entitlement(p.householdId, "doku"))!.periodEnd!.getTime();
    const again = await dokuNotify(id, 29_000);
    expect(again).toEqual({ status: 200, body: { received: true, activated: false } });
    expect((await entitlement(p.householdId, "doku"))!.periodEnd!.getTime()).toBe(first);
  });

  test("wrong amount, unknown order and failed payments", async () => {
    const p = await testPrincipal(db);
    const id = await pendingOrder(p);
    expect((await dokuNotify(id, 1_000)).status).toBe(400);
    expect((await dokuNotify("ART-261104000000-00000000", 29_000)).status).toBe(404);
    expect((await dokuNotify(id, 29_000, { status: "PENDING" })).status).toBe(200);
    expect((await order(id))?.status).toBe("pending");
    expect((await dokuNotify(id, 29_000, { status: "EXPIRED" })).status).toBe(200);
    expect((await order(id))?.status).toBe("failed");
    // A late SUCCESS cannot revive it.
    expect((await dokuNotify(id, 29_000)).body).toEqual({ received: true, activated: false });
    expect(await entitlement(p.householdId, "doku")).toBeUndefined();
  });

  test("months stack on paid time and on the trial or grandfathered period", async () => {
    const p = await testPrincipal(db);
    const now = new Date();
    cfg = config({ trialDays: 14 });
    const monthly = await pendingOrder(p);
    await dokuNotify(monthly, 29_000, { now });
    const [h] = await db.select({ createdAt: schema.household.createdAt }).from(schema.household).where(eq(schema.household.id, p.householdId));
    const trialEnd = new Date(h!.createdAt.getTime() + 14 * DAY);
    expect((await entitlement(p.householdId, "doku"))!.periodEnd!.getTime()).toBe(addMonths(trialEnd, 1).getTime());
    const yearly = await pendingOrder(p, { months: 12, amountIdr: 290_000 });
    await dokuNotify(yearly, 290_000, { now });
    expect((await entitlement(p.householdId, "doku"))!.periodEnd!.getTime()).toBe(addMonths(addMonths(trialEnd, 1), 12).getTime());
  });
});

describe("DOKU checkout", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("creates a pending order at the founder price while seats last, and the household keeps it", async () => {
    const sent: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ response: { payment: { url: "https://sandbox.doku.test/pay/1" } } }), { status: 200 });
    }) as typeof fetch;
    cfg = config({ founder: { priceIdr: { monthly: 19_000, yearly: 190_000 }, slots: 1 } });
    const a = await testPrincipal(db, "A");
    const b = await testPrincipal(db, "B");

    const first = await startDokuCheckout(db, a, cfg, checkoutInput.parse({}));
    expect(first.paymentUrl).toBe("https://sandbox.doku.test/pay/1");
    expect(sent[0]!.url).toBe("https://api-sandbox.doku.com/checkout/v1/payment");
    expect(sent[0]!.body).toMatchObject({ order: { amount: 19_000, invoice_number: first.orderId }, additional_info: { override_notification_url: "https://app.test/api/billing/doku/webhook" } });
    expect(await order(first.orderId)).toMatchObject({ status: "pending", amount: 1_900_000, priceTier: "founder", isTest: true, householdId: a.householdId });
    await dokuNotify(first.orderId, 19_000);

    // The only founder seat is taken: B pays the standard price, A keeps the founder price.
    const forB = await startDokuCheckout(db, b, cfg, checkoutInput.parse({ interval: "yearly" }));
    expect(await order(forB.orderId)).toMatchObject({ amount: 29_000_000, priceTier: "standard", months: 12 });
    const againA = await startDokuCheckout(db, a, cfg, checkoutInput.parse({}));
    expect(await order(againA.orderId)).toMatchObject({ amount: 1_900_000, priceTier: "founder" });
  });

  test("a failed DOKU call marks the order failed", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const p = await testPrincipal(db);
    await expect(startDokuCheckout(db, p, cfg, checkoutInput.parse({}))).rejects.toThrow("Couldn't open the payment page");
    const [row] = await db.select().from(schema.billingOrder).where(eq(schema.billingOrder.householdId, p.householdId));
    expect(row?.status).toBe("failed");
  });
});

// ------------------------------------------------------------------------------------------------ Polar

type PolarSub = { id: string; status: string; product_id: string; current_period_end: string; cancel_at_period_end?: boolean; modified_at: string };

function polarSub(householdId: string, over: Partial<PolarSub> = {}) {
  return {
    id: "sub_1",
    status: "active",
    customer_id: "cus_1",
    product_id: "prod_monthly",
    created_at: "2026-11-04T00:00:00Z",
    modified_at: "2026-11-04T00:00:00Z",
    current_period_end: "2026-12-04T00:00:00Z",
    cancel_at_period_end: false,
    customer: { id: "cus_1", external_id: householdId },
    ...over,
  };
}

async function polarDeliver(type: string, data: unknown, opts: { id?: string; secret?: string; now?: Date; timestamp?: string } = {}) {
  const now = opts.now ?? new Date("2026-11-10T00:00:00Z");
  const body = JSON.stringify({ type, data });
  const id = opts.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = opts.timestamp ?? String(Math.floor(now.getTime() / 1000));
  const signature = await signPolarWebhook(body, id, timestamp, opts.secret ?? POLAR_SECRET);
  const headers: Record<string, string> = { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature };
  return handlePolarWebhook(db, cfg, { header: (n) => headers[n], body }, now);
}

function polarOrder(householdId: string, over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    status: "paid",
    billing_reason: "subscription_create",
    currency: "usd",
    net_amount: 299,
    customer_id: "cus_1",
    product_id: "prod_monthly",
    subscription_id: "sub_1",
    customer: { id: "cus_1", external_id: householdId },
    subscription: polarSub(householdId),
    ...over,
  };
}

describe("Polar webhook", () => {
  test("Standard Webhooks signatures: valid, wrong key, stale", async () => {
    const body = '{"type":"x","data":{}}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await signPolarWebhook(body, "msg_1", ts, POLAR_SECRET);
    expect(await verifyPolarWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, POLAR_SECRET)).toBe(true);
    expect(await verifyPolarWebhook(body, { id: "msg_2", timestamp: ts, signature: sig }, POLAR_SECRET)).toBe(false);
    expect(await verifyPolarWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, `whsec_${btoa("other")}`)).toBe(false);
    expect(await verifyPolarWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, POLAR_SECRET, Date.now() + 10 * 60_000)).toBe(false);
  });

  test("order.paid records the order and makes the household Pro; replays do nothing", async () => {
    const p = await testPrincipal(db);
    const res = await polarDeliver("order.paid", polarOrder(p.householdId), { id: "msg_paid" });
    expect(res).toEqual({ status: 200, body: { received: true, outcome: "granted" } });
    expect(await order("polar:ord_1")).toMatchObject({ householdId: p.householdId, provider: "polar", status: "paid", amount: 299, currency: "USD", isTest: true });
    expect(await entitlement(p.householdId, "polar")).toMatchObject({ status: "active", providerSubscriptionId: "sub_1", providerCustomerId: "cus_1" });
    expect((await householdPlan(db, p.householdId, cfg, new Date("2026-11-20T00:00:00Z"))).entitlement).toMatchObject({ plan: "pro", provider: "polar" });

    // Same delivery again, and the same order under a new delivery id.
    expect((await polarDeliver("order.paid", polarOrder(p.householdId), { id: "msg_paid" })).body.outcome).toBe("duplicate");
    expect((await polarDeliver("order.paid", polarOrder(p.householdId))).body.outcome).toBe("already");
    expect((await db.select().from(schema.billingOrder)).length).toBe(1);
  });

  test("bad signatures are refused; other products are ignored", async () => {
    const p = await testPrincipal(db);
    expect((await polarDeliver("order.paid", polarOrder(p.householdId), { secret: `whsec_${btoa("attacker")}` })).status).toBe(403);
    expect((await polarDeliver("order.paid", polarOrder(p.householdId), { timestamp: "1000000000" })).status).toBe(403);
    expect(await order("polar:ord_1")).toBeUndefined();
    expect((await polarDeliver("order.paid", polarOrder(p.householdId, { product_id: "prod_other_app" }))).body.outcome).toBe("ignored");
  });

  test("subscription events: cancel, older events, past_due, revoke", async () => {
    const p = await testPrincipal(db);
    await polarDeliver("order.paid", polarOrder(p.householdId));
    await polarDeliver("subscription.updated", polarSub(p.householdId, { cancel_at_period_end: true, modified_at: "2026-11-06T00:00:00Z" }));
    expect(await entitlement(p.householdId, "polar")).toMatchObject({ status: "canceled", cancelAtPeriodEnd: true });
    // An older event arriving late does not undo the cancel.
    await polarDeliver("subscription.updated", polarSub(p.householdId, { modified_at: "2026-11-05T00:00:00Z" }));
    expect((await entitlement(p.householdId, "polar"))?.status).toBe("canceled");
    await polarDeliver("subscription.updated", polarSub(p.householdId, { status: "past_due", modified_at: "2026-12-05T00:00:00Z" }));
    expect((await entitlement(p.householdId, "polar"))?.status).toBe("past_due");
    const now = new Date("2026-12-06T00:00:00Z");
    await polarDeliver("subscription.revoked", polarSub(p.householdId, { status: "canceled", modified_at: "2026-12-06T00:00:00Z" }), { now });
    expect(await entitlement(p.householdId, "polar")).toMatchObject({ status: "expired" });
    expect((await householdPlan(db, p.householdId, cfg, new Date("2026-12-06T01:00:00Z"))).entitlement.plan).toBe("free");
  });

  test("refunds mark the order", async () => {
    const p = await testPrincipal(db);
    await polarDeliver("order.paid", polarOrder(p.householdId));
    expect((await polarDeliver("order.refunded", polarOrder(p.householdId, { status: "refunded" }))).body.outcome).toBe("refunded");
    expect((await order("polar:ord_1"))?.status).toBe("refunded");
  });
});

// ------------------------------------------------------------------------------------------------ household scoping

describe("household scoping", () => {
  test("orders and Pro belong to the household that paid", async () => {
    const a = await testPrincipal(db, "A");
    const b = await testPrincipal(db, "B");
    const id = await pendingOrder(a);
    await dokuNotify(id, 29_000);
    expect((await getOrder(db, a, id)).status).toBe("paid");
    await expect(getOrder(db, b, id)).rejects.toThrow("Order not found");
    expect((await billingStatus(db, b, cfg, 30)).orders).toEqual([]);
    expect((await billingStatus(db, a, cfg, 30)).orders.map((o) => o.id)).toEqual([id]);
    expect((await householdPlan(db, a.householdId, cfg)).entitlement.plan).toBe("pro");
    expect((await householdPlan(db, b.householdId, cfg)).entitlement.plan).toBe("free");
  });

  test("a Polar event for one household never touches another", async () => {
    const a = await testPrincipal(db, "A");
    const b = await testPrincipal(db, "B");
    await polarDeliver("order.paid", polarOrder(a.householdId));
    expect(await entitlement(b.householdId, "polar")).toBeUndefined();
    // A household id that does not exist is not credited anywhere.
    expect((await polarDeliver("order.paid", polarOrder("no-such-household", { id: "ord_2", subscription_id: "sub_2", subscription: null }))).body.outcome).toBe("no-household");
  });

  test("every member shares the household's plan", async () => {
    const owner = await testPrincipal(db, "Owner");
    const partner = await testPrincipal(db, "Partner");
    await db.insert(schema.householdMember).values({ householdId: owner.householdId, userId: partner.userId, role: "member" });
    await dokuNotify(await pendingOrder(owner), 29_000);
    const partnerInOwners: Principal = { ...partner, householdId: owner.householdId };
    expect((await billingStatus(db, partnerInOwners, cfg, 30)).plan).toBe("pro");
  });
});

// ------------------------------------------------------------------------------------------------ limits

describe("Free limits", () => {
  test("statement imports: two a month on Free, counted when rows are saved", async () => {
    const p = await testPrincipal(db);
    const jago = await importStatement(db, p, { text: sampleJagoText(), commit: true }, { billing: cfg });
    expect(jago.kind === "jago" && jago.totals.inserted).toBeGreaterThan(0);
    await importStatement(db, p, { text: sampleGopayText(), commit: true }, { billing: cfg });
    expect((await billingStatus(db, p, cfg, 30)).usage.statementImports).toMatchObject({ used: 2, limit: 2 });
    // The third, even a preview, asks for an upgrade.
    await expectUpgrade(importStatement(db, p, { text: sampleJagoText(), commit: false }, { billing: cfg }), "statementImports");
  });

  test("re-importing a statement that adds nothing is not counted", async () => {
    const p = await testPrincipal(db);
    await importStatement(db, p, { text: sampleJagoText(), commit: true }, { billing: cfg });
    await importStatement(db, p, { text: sampleJagoText(), commit: true }, { billing: cfg });
    expect((await billingStatus(db, p, cfg, 30)).usage.statementImports.used).toBe(1);
  });

  test("Pro and self-hosts are unlimited", async () => {
    const p = await testPrincipal(db);
    await db.insert(schema.usageCounter).values({ householdId: p.householdId, metric: "statement_import", period: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7), count: 50 });
    await expectUpgrade(assertStatementImport(db, p.householdId, cfg), "statementImports");
    await assertStatementImport(db, p.householdId, undefined);
    await assertStatementImport(db, p.householdId, config({ enforced: false }));
    await dokuNotify(await pendingOrder(p), 29_000);
    await assertStatementImport(db, p.householdId, cfg);
  });

  test("members: two on Free, pending invites included", async () => {
    const p = await testPrincipal(db);
    await createInvite(db, p, { email: "partner@example.com", role: "member" }, cfg);
    // Re-inviting the same address takes no new seat.
    await createInvite(db, p, { email: "partner@example.com", role: "member" }, cfg);
    await expectUpgrade(createInvite(db, p, { email: "nanny@example.com", role: "member" }, cfg), "members");
    await dokuNotify(await pendingOrder(p), 29_000);
    await createInvite(db, p, { email: "nanny@example.com", role: "member" }, cfg);
    await expect(assertMemberSeat(db, p.householdId, undefined, { countPending: true })).resolves.toBeUndefined();
  });

  test("saved scenarios are Pro; editing one saved before stays allowed", async () => {
    const p = await testPrincipal(db);
    const plan = { items: [] };
    await expectUpgrade(saveScenario(db, p, { name: "Car", plan } as never, cfg), "savedScenarios");
    const saved = await saveScenario(db, p, { name: "Car", plan } as never, undefined);
    const again = await saveScenario(db, p, { id: saved.scenario.id, name: "Car", plan } as never, cfg);
    expect(again.created).toBe(false);
    await expectUpgrade(assertScenarioSlot(db, p.householdId, cfg, 1), "savedScenarios");
  });

  test("email import and the Claude connector are Pro; Joyo AI has a lower cap on Free", async () => {
    const p = await testPrincipal(db);
    await expectUpgrade(requireFeature(db, p.householdId, cfg, "emailImport"), "emailImport");
    await expectUpgrade(requireFeature(db, p.householdId, cfg, "mcpConnector"), "mcpConnector");
    expect(await chatCap(db, p.householdId, cfg, 30)).toEqual({ cap: 5, plan: "free" });
    expect(await chatCap(db, p.householdId, cfg, 3)).toEqual({ cap: 3, plan: "free" });
    await dokuNotify(await pendingOrder(p), 29_000);
    await requireFeature(db, p.householdId, cfg, "mcpConnector");
    expect(await chatCap(db, p.householdId, cfg, 30)).toEqual({ cap: 30, plan: "pro" });
  });
});
