// Payment webhooks. Public endpoints: trust comes from the signature only (DOKU: HMAC over the request; Polar:
// Standard Webhooks). Both are idempotent: a DOKU order flips pending -> paid once, and Polar deliveries are recorded
// by webhook-id after they were handled (a failure is redelivered, a replay does nothing).
// apps/server/src/billing.ts mounts them; they live here so tests can drive them against the test database.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import type { BillingInterval, EntitlementStatus } from "@baroka/db/schema/billing";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { BillingConfig } from "../lib/billing/config";
import { WEBHOOK_TARGET, isFailed, isOrderId, isPaid, parseNotification, verifySignature } from "../lib/billing/doku";
import { POLAR_SANDBOX_URL, polarOrderId, polarProductInterval, verifyPolarWebhook } from "../lib/billing/polar";
import { activateDokuOrder, markOrderFailed, planMonths } from "./billing";

export type WebhookRequest = { header: (name: string) => string | undefined; body: string };
export type WebhookResponse = { status: 200 | 400 | 401 | 403 | 404 | 409; body: Record<string, unknown> };

const e = schema.householdEntitlement;
const o = schema.billingOrder;

// ------------------------------------------------------------------------------------------------ DOKU

export async function handleDokuWebhook(db: Database, config: BillingConfig | undefined, req: WebhookRequest, now = new Date()): Promise<WebhookResponse> {
  const doku = config?.doku;
  if (!config || !doku) return { status: 404, body: { error: "billing disabled" } };
  const clientId = req.header("Client-Id") ?? "";
  const valid =
    clientId === doku.clientId &&
    (await verifySignature(
      { clientId, requestId: req.header("Request-Id") ?? "", timestamp: req.header("Request-Timestamp") ?? "", target: WEBHOOK_TARGET, body: req.body },
      req.header("Signature") ?? "",
      doku.secretKey,
    ));
  if (!valid) return { status: 401, body: { error: "invalid signature" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const n = parseNotification(parsed);
  if (!n || !isOrderId(n.invoiceNumber)) return { status: 400, body: { error: "invalid notification" } };
  const [order] = await db.select().from(o).where(eq(o.id, n.invoiceNumber));
  if (!order || order.provider !== "doku") return { status: 404, body: { error: "order not found" } };

  if (isFailed(n)) {
    await markOrderFailed(db, order.id);
    return { status: 200, body: { received: true } };
  }
  if (!isPaid(n)) return { status: 200, body: { received: true } };
  if (order.status === "paid") return { status: 200, body: { received: true, activated: false } };
  // DOKU amounts are whole rupiah; orders keep minor units.
  if (Math.round(n.amount) * 100 !== order.amount) return { status: 400, body: { error: "amount mismatch" } };

  const result = await activateDokuOrder(db, config, order.id, now);
  if (result === "activated") return { status: 200, body: { received: true, activated: true } };
  if (result === "conflict") return { status: 409, body: { error: "concurrent update, retry" } };
  if (result === "not_found") return { status: 404, body: { error: "household gone" } };
  return { status: 200, body: { received: true, activated: false } };
}

// ------------------------------------------------------------------------------------------------ Polar

const customerSchema = z.object({ id: z.string(), external_id: z.string().nullish() });

const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer_id: z.string(),
  product_id: z.string(),
  created_at: z.string(),
  modified_at: z.string().nullish(),
  current_period_end: z.string().nullish(),
  cancel_at_period_end: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  customer: customerSchema.nullish(),
});
type PolarSubscription = z.infer<typeof subscriptionSchema>;

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  billing_reason: z.string(),
  currency: z.string(),
  net_amount: z.number().int(),
  customer_id: z.string(),
  product_id: z.string().nullish(),
  subscription_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  customer: customerSchema.nullish(),
  subscription: subscriptionSchema.nullish(),
});
type PolarOrder = z.infer<typeof orderSchema>;

const envelopeSchema = z.object({ type: z.string(), data: z.unknown() });

export type PolarOutcome = "granted" | "already" | "refunded" | "synced" | "ignored" | "no-household" | "duplicate" | "invalid";

export async function handlePolarWebhook(db: Database, config: BillingConfig | undefined, req: WebhookRequest, now = new Date()): Promise<WebhookResponse> {
  const polar = config?.polar;
  if (!config || !polar) return { status: 404, body: { error: "billing disabled" } };
  const eventId = req.header("webhook-id") ?? "";
  const valid = await verifyPolarWebhook(
    req.body,
    { id: eventId, timestamp: req.header("webhook-timestamp") ?? "", signature: req.header("webhook-signature") ?? "" },
    polar.webhookSecret,
    now.getTime(),
  );
  if (!valid) return { status: 403, body: { error: "invalid signature" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const outcome = await processPolarEvent(db, config, eventId, parsed, now);
  // Polar disables an endpoint after repeated failures: everything verified answers 200, even events we ignore.
  return { status: 200, body: { received: true, outcome } };
}

/** One verified Polar delivery. Idempotent by `webhook-id`, and by the order id for a replay under a new delivery id. */
export async function processPolarEvent(db: Database, config: BillingConfig, eventId: string, payload: unknown, now = new Date()): Promise<PolarOutcome> {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return "invalid";
  const ev = schema.billingEvent;
  const [seen] = await db
    .select({ id: ev.eventId })
    .from(ev)
    .where(and(eq(ev.provider, "polar"), eq(ev.eventId, eventId)));
  if (seen) return "duplicate";
  const outcome = await dispatch(db, config, envelope.data.type, envelope.data.data, now);
  await db.insert(ev).values({ provider: "polar", eventId, type: envelope.data.type.slice(0, 80) }).onConflictDoNothing();
  return outcome;
}

async function dispatch(db: Database, config: BillingConfig, type: string, data: unknown, now: Date): Promise<PolarOutcome> {
  if (type === "order.paid" || type === "order.refunded") {
    const order = orderSchema.safeParse(data);
    if (!order.success) {
      console.error(`polar ${type}: unreadable order payload: ${order.error.message}`);
      return "invalid";
    }
    return type === "order.paid" ? orderPaid(db, config, order.data, now) : orderRefunded(db, config, order.data);
  }
  if (type.startsWith("subscription.")) {
    const sub = subscriptionSchema.safeParse(data);
    if (!sub.success) {
      console.error(`polar ${type}: unreadable subscription payload: ${sub.error.message}`);
      return "invalid";
    }
    const interval = polarProductInterval(config.polar!, sub.data.product_id);
    if (!interval) return "ignored";
    const householdId = await resolveHousehold(db, { customer: sub.data.customer, metadata: sub.data.metadata, subscriptionId: sub.data.id });
    if (!householdId) return "no-household";
    await syncSubscription(db, householdId, type, sub.data, interval, now);
    return "synced";
  }
  return "ignored";
}

/** The household a Polar event belongs to: the customer's external id (set at checkout), metadata, or the stored subscription. */
async function resolveHousehold(
  db: Database,
  hint: { customer?: { external_id?: string | null } | null; metadata?: Record<string, unknown> | null; subscriptionId?: string | null },
): Promise<string | null> {
  const fromMetadata = typeof hint.metadata?.household_id === "string" ? hint.metadata.household_id : null;
  const candidates = [hint.customer?.external_id ?? null, fromMetadata].filter((v): v is string => !!v);
  if (hint.subscriptionId) {
    const [row] = await db.select({ householdId: e.householdId }).from(e).where(eq(e.providerSubscriptionId, hint.subscriptionId)).limit(1);
    if (row) candidates.push(row.householdId);
  }
  for (const id of candidates) {
    const [h] = await db.select({ id: schema.household.id }).from(schema.household).where(eq(schema.household.id, id));
    if (h) return h.id;
  }
  return null;
}

async function orderPaid(db: Database, config: BillingConfig, order: PolarOrder, now: Date): Promise<PolarOutcome> {
  const interval = polarProductInterval(config.polar!, order.product_id);
  if (!interval || order.status !== "paid") return "ignored";
  const householdId = await resolveHousehold(db, { customer: order.customer, metadata: order.metadata, subscriptionId: order.subscription_id });
  if (!householdId) {
    console.error(`polar order ${order.id} paid but no household matches`);
    return "no-household";
  }
  const periodEnd = order.subscription?.current_period_end ? new Date(order.subscription.current_period_end) : null;
  const inserted = await db
    .insert(o)
    .values({
      id: polarOrderId(order.id),
      householdId,
      provider: "polar",
      interval,
      // A plan-change proration grants no time of its own.
      months: order.billing_reason === "subscription_update" ? 0 : planMonths(interval),
      amount: order.net_amount,
      currency: order.currency.toUpperCase(),
      status: "paid",
      providerRef: order.id,
      periodEnd,
      isTest: config.polar!.baseUrl === POLAR_SANDBOX_URL,
      paidAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: o.id });
  if (order.subscription && order.subscription.status !== "incomplete") await syncSubscription(db, householdId, "order.paid", order.subscription, interval, now);
  return inserted.length ? "granted" : "already";
}

/** A refund marks the order. Access follows the subscription: revoke it in Polar (or let it run out) to end Pro. */
async function orderRefunded(db: Database, config: BillingConfig, order: PolarOrder): Promise<PolarOutcome> {
  if (!polarProductInterval(config.polar!, order.product_id) || order.status !== "refunded") return "ignored";
  const updated = await db
    .update(o)
    .set({ status: "refunded" })
    .where(and(eq(o.id, polarOrderId(order.id)), eq(o.status, "paid")))
    .returning({ id: o.id });
  return updated.length ? "refunded" : "already";
}

/** Our status for a Polar subscription. */
export function polarStatus(type: string, sub: Pick<PolarSubscription, "status" | "cancel_at_period_end">): EntitlementStatus {
  if (type === "subscription.revoked") return "expired";
  switch (sub.status) {
    case "active":
    case "trialing":
      return sub.cancel_at_period_end ? "canceled" : "active";
    case "past_due":
      return "past_due";
    default:
      // canceled, unpaid, incomplete, incomplete_expired: no access.
      return "expired";
  }
}

/** Stores the subscription's latest state on the household's Polar entitlement. An older event never overwrites a newer one. */
async function syncSubscription(db: Database, householdId: string, type: string, sub: PolarSubscription, interval: BillingInterval, now: Date) {
  const modifiedMs = Date.parse(sub.modified_at ?? sub.created_at);
  const status = polarStatus(type, sub);
  const values = {
    status,
    interval,
    // Revoked ends access now, whatever was left of the period.
    periodEnd: type === "subscription.revoked" ? now : sub.current_period_end ? new Date(sub.current_period_end) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    providerCustomerId: sub.customer_id,
    providerSubscriptionId: sub.id,
    providerModifiedAt: new Date(Number.isFinite(modifiedMs) ? modifiedMs : now.getTime()),
    updatedAt: now,
  };
  await db
    .insert(e)
    .values({ householdId, provider: "polar", ...values })
    .onConflictDoUpdate({
      target: [e.householdId, e.provider],
      set: values,
      setWhere: or(isNull(e.providerModifiedAt), lte(e.providerModifiedAt, values.providerModifiedAt)) ?? sql`1`,
    });
}
