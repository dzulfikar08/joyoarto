// JoyoArto Pro, per household: which plan a household is on, the Free limits, checkout (DOKU in rupiah, Polar in US
// dollars), orders and their status. Every query is scoped by the principal's householdId. Webhooks: billing-webhooks.ts.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { BILLING_INTERVALS } from "@baroka/db/schema/billing";
import type { BillingInterval } from "@baroka/db/schema/billing";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import type { BillingConfig, PriceIdr } from "../lib/billing/config";
import { WEBHOOK_TARGET, buildOrderId, checkStatus, createCheckout, isPaid } from "../lib/billing/doku";
import { freeTimeEnd, nextPeriodEnd, resolveEntitlement, wibMonth } from "../lib/billing/entitlement";
import type { Entitlement } from "../lib/billing/entitlement";
import { PLAN_LIMITS, STATEMENT_IMPORT_METRIC } from "../lib/billing/plans";
import type { PlanLimits, UpgradeFeature } from "../lib/billing/plans";
import { createPolarCheckout, createPolarPortal } from "../lib/billing/polar";
import { formatMoney } from "../lib/money";
import { notFound } from "./common";

const e = schema.householdEntitlement;
const o = schema.billingOrder;
const hm = schema.householdMember;

/**
 * A Free limit was hit. FORBIDDEN with `data.upgrade`, so the web app shows its upgrade prompt (apps/web/src/lib/billing.ts)
 * and MCP/REST callers get a readable message.
 */
export function upgradeRequired(feature: UpgradeFeature, message: string, extra: Record<string, unknown> = {}): never {
  throw new ORPCError("FORBIDDEN", { message: `${message} Upgrade to JoyoArto Pro in Settings → Billing.`, data: { upgrade: true, feature, ...extra } });
}

export type HouseholdPlan = { entitlement: Entitlement; limits: PlanLimits };

const SELF_HOST: HouseholdPlan = {
  entitlement: { plan: "pro", source: "selfhost", status: "active", provider: null, interval: null, periodEnd: null, cancelAtPeriodEnd: false },
  limits: PLAN_LIMITS.pro,
};

/** The household's plan now. Without billing config (self-host, tests) every household is Pro and nothing is read. */
export async function householdPlan(db: Database, householdId: string, config: BillingConfig | undefined, now = new Date()): Promise<HouseholdPlan> {
  if (!config?.enforced) return SELF_HOST;
  const [rows, [household], memberEmails] = await db.batch([
    db
      .select({ provider: e.provider, status: e.status, interval: e.interval, periodEnd: e.periodEnd, cancelAtPeriodEnd: e.cancelAtPeriodEnd })
      .from(e)
      .where(eq(e.householdId, householdId)),
    db.select({ createdAt: schema.household.createdAt }).from(schema.household).where(eq(schema.household.id, householdId)),
    db.select({ email: schema.user.email }).from(hm).innerJoin(schema.user, eq(schema.user.id, hm.userId)).where(eq(hm.householdId, householdId)),
  ]);
  const granted = memberEmails.some((m) => config.proEmails.includes(m.email.toLowerCase()));
  const entitlement = resolveEntitlement({ config, rows, householdCreatedAt: household?.createdAt ?? now, granted, now });
  return { entitlement, limits: PLAN_LIMITS[entitlement.plan] };
}

// ------------------------------------------------------------------------------------------------ limits

/** Pro-only features (email import, the Claude connector). */
export async function requireFeature(db: Database, householdId: string, config: BillingConfig | undefined, feature: "emailImport" | "mcpConnector") {
  const { limits } = await householdPlan(db, householdId, config);
  if (limits[feature]) return;
  if (feature === "emailImport") upgradeRequired(feature, "Importing statements by email is part of JoyoArto Pro.");
  upgradeRequired(feature, "The Claude connector (MCP) is part of JoyoArto Pro.");
}

async function usage(db: Database, householdId: string, metric: string, period: string): Promise<number> {
  const uc = schema.usageCounter;
  const [row] = await db
    .select({ count: uc.count })
    .from(uc)
    .where(and(eq(uc.householdId, householdId), eq(uc.metric, metric), eq(uc.period, period)));
  return row?.count ?? 0;
}

/** Before reading a statement: a Free household that used this month's imports gets the upgrade prompt (preview included). */
export async function assertStatementImport(db: Database, householdId: string, config: BillingConfig | undefined, now = new Date()) {
  const { limits } = await householdPlan(db, householdId, config, now);
  const limit = limits.statementImportsPerMonth;
  if (limit === null) return;
  const used = await usage(db, householdId, STATEMENT_IMPORT_METRIC, wibMonth(now));
  if (used >= limit) {
    upgradeRequired("statementImports", `Free includes ${limit} statement imports a month and this month's are used.`, { limit, used });
  }
}

/** After a committed statement import that added rows. Counted for every plan, so a downgrade starts from the truth. */
export async function countStatementImport(db: Database, householdId: string, now = new Date()) {
  const uc = schema.usageCounter;
  await db
    .insert(uc)
    .values({ householdId, metric: STATEMENT_IMPORT_METRIC, period: wibMonth(now), count: 1, updatedAt: now })
    .onConflictDoUpdate({ target: [uc.householdId, uc.metric, uc.period], set: { count: sql`${uc.count} + 1`, updatedAt: now } });
}

/** Members plus pending invites must stay within the plan (`adding` = the person about to be invited or to join). */
export async function assertMemberSeat(db: Database, householdId: string, config: BillingConfig | undefined, opts: { countPending: boolean }) {
  const { limits, entitlement } = await householdPlan(db, householdId, config);
  const inv = schema.householdInvite;
  const [[members], [pending]] = await db.batch([
    db.select({ n: count() }).from(hm).where(eq(hm.householdId, householdId)),
    db
      .select({ n: count() })
      .from(inv)
      .where(and(eq(inv.householdId, householdId), isNull(inv.acceptedAt), gt(inv.expiresAt, new Date()))),
  ]);
  const used = (members?.n ?? 0) + (opts.countPending ? (pending?.n ?? 0) : 0);
  if (used < limits.members) return;
  if (entitlement.plan === "pro") throw new ORPCError("BAD_REQUEST", { message: `A household can have at most ${limits.members} members.` });
  upgradeRequired("members", `Free households have up to ${limits.members} members (pending invites count).`, { limit: limits.members, used });
}

/** Saving a new scenario (updating an existing one stays allowed, so nothing saved is lost after a downgrade). */
export async function assertScenarioSlot(db: Database, householdId: string, config: BillingConfig | undefined, existing: number) {
  const { limits, entitlement } = await householdPlan(db, householdId, config);
  if (existing < limits.savedScenarios) return;
  if (entitlement.plan === "pro") throw new ORPCError("BAD_REQUEST", { message: `A household can keep at most ${limits.savedScenarios} saved scenarios; delete some first.` });
  upgradeRequired("savedScenarios", "Saving scenarios is part of JoyoArto Pro. Your draft stays on this device.", { limit: limits.savedScenarios });
}

/** Hosted Joyo AI questions per member today: the plan's cap, never above the server's. */
export async function chatCap(db: Database, householdId: string, config: BillingConfig | undefined, serverCap: number): Promise<{ cap: number; plan: "free" | "pro" }> {
  const { limits, entitlement } = await householdPlan(db, householdId, config);
  return { cap: limits.aiDailyCap === null ? serverCap : Math.min(limits.aiDailyCap, serverCap), plan: entitlement.plan };
}

// ------------------------------------------------------------------------------------------------ prices

type Price = { priceIdr: PriceIdr; tier: "standard" | "founder"; founderSlotsLeft: number | null };

/** Founder price while seats are left, and for good for a household that already bought at it. */
export async function priceFor(db: Database, householdId: string | null, config: BillingConfig): Promise<Price> {
  if (!config.founder) return { priceIdr: config.priceIdr, tier: "standard", founderSlotsLeft: null };
  const founderPaid = and(eq(o.status, "paid"), eq(o.priceTier, "founder"), gt(o.amount, 0));
  const [[taken], mine] = await db.batch([
    db.select({ n: sql<number>`count(distinct ${o.householdId})` }).from(o).where(founderPaid),
    db
      .select({ id: o.id })
      .from(o)
      .where(and(founderPaid, eq(o.householdId, householdId ?? "")))
      .limit(1),
  ]);
  const left = Math.max(0, config.founder.slots - (taken?.n ?? 0));
  if (mine.length || left > 0) return { priceIdr: config.founder.priceIdr, tier: "founder", founderSlotsLeft: left };
  return { priceIdr: config.priceIdr, tier: "standard", founderSlotsLeft: 0 };
}

export function planMonths(interval: BillingInterval): number {
  return interval === "yearly" ? 12 : 1;
}

/** Public price list for the pricing page and landing (no session needed). */
export async function publicPricing(db: Database, config: BillingConfig | undefined, serverAiCap: number) {
  const limits = { free: PLAN_LIMITS.free, pro: { ...PLAN_LIMITS.pro, aiDailyCap: serverAiCap } };
  if (!config) return { available: false, enforced: false, priceIdr: null, founder: null, usdCents: null, trialDays: 0, limits };
  const founder = config.founder ? await priceFor(db, null, config) : null;
  return {
    available: config.doku !== null || config.polar !== null,
    enforced: config.enforced,
    priceIdr: config.priceIdr,
    founder: config.founder && founder ? { priceIdr: config.founder.priceIdr, slotsLeft: founder.founderSlotsLeft ?? 0 } : null,
    usdCents: config.polar?.priceUsdCents ?? null,
    trialDays: config.trialDays,
    limits,
  };
}

// ------------------------------------------------------------------------------------------------ status

function orderView(row: typeof o.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    interval: row.interval,
    months: row.months,
    amount: row.amount,
    currency: row.currency,
    display: formatMoney(row.amount, row.currency),
    priceTier: row.priceTier,
    status: row.status,
    isTest: row.isTest,
    periodEnd: row.periodEnd,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
  };
}

/** Settings → Billing: plan, renewal, usage against the limits, checkout options, recent orders. */
export async function billingStatus(db: Database, p: Principal, config: BillingConfig | undefined, serverAiCap: number, now = new Date()) {
  const plan = await householdPlan(db, p.householdId, config, now);
  const inv = schema.householdInvite;
  const [orders, [members], [pending], [household], polarRows] = await db.batch([
    db.select().from(o).where(eq(o.householdId, p.householdId)).orderBy(desc(o.createdAt)).limit(20),
    db.select({ n: count() }).from(hm).where(eq(hm.householdId, p.householdId)),
    db
      .select({ n: count() })
      .from(inv)
      .where(and(eq(inv.householdId, p.householdId), isNull(inv.acceptedAt), gt(inv.expiresAt, now))),
    db.select({ createdAt: schema.household.createdAt }).from(schema.household).where(eq(schema.household.id, p.householdId)),
    db
      .select({ status: e.status })
      .from(e)
      .where(and(eq(e.householdId, p.householdId), eq(e.provider, "polar"))),
  ]);
  const period = wibMonth(now);
  const used = await usage(db, p.householdId, STATEMENT_IMPORT_METRIC, period);
  const price = config && (config.doku || config.polar) ? await priceFor(db, p.householdId, config) : null;
  const free = config && household ? freeTimeEnd(config, household.createdAt) : null;
  const limits = { ...plan.limits, aiDailyCap: plan.limits.aiDailyCap === null ? serverAiCap : Math.min(plan.limits.aiDailyCap, serverAiCap) };
  const recentPending = orders.find((r) => r.status === "pending" && r.provider === "doku" && now.getTime() - r.createdAt.getTime() < 2 * 86_400_000);
  return {
    enforced: config?.enforced ?? false,
    plan: plan.entitlement.plan,
    entitlement: plan.entitlement,
    limits,
    usage: {
      statementImports: { used, limit: limits.statementImportsPerMonth, period },
      members: { used: (members?.n ?? 0) + (pending?.n ?? 0), limit: limits.members },
    },
    checkout: { doku: !!config?.doku, polar: !!config?.polar },
    price: price && config ? { idr: price.priceIdr, tier: price.tier, standardIdr: config.priceIdr, founderSlotsLeft: price.founderSlotsLeft, usdCents: config.polar?.priceUsdCents ?? null } : null,
    /** Paid DOKU months start after this (trial or grandfathered Pro). */
    freeTimeEnd: free && free.end.getTime() > now.getTime() ? free.end : null,
    polarSubscription: polarRows[0]?.status ?? null,
    pendingOrder: recentPending ? orderView(recentPending) : null,
    orders: orders.map(orderView),
  };
}

// ------------------------------------------------------------------------------------------------ DOKU checkout

export const checkoutInput = z.object({ interval: z.enum(BILLING_INTERVALS).default("monthly") });

async function buyer(db: Database, userId: string) {
  const [u] = await db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  return u ?? notFound("User");
}

async function liveRenewingPolar(db: Database, householdId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: e.status })
    .from(e)
    .where(and(eq(e.householdId, householdId), eq(e.provider, "polar"), inArray(e.status, ["active", "past_due"])));
  return !!row;
}

/** Creates the order, then DOKU's hosted page (QRIS, e-wallets, VA). The buyer comes back to /payment?order=<id>. */
export async function startDokuCheckout(db: Database, p: Principal, config: BillingConfig | undefined, input: z.infer<typeof checkoutInput>) {
  const doku = config?.doku;
  if (!config || !doku) throw new ORPCError("NOT_FOUND", { message: "Paying in rupiah is not available on this server." });
  if (await liveRenewingPolar(db, p.householdId)) {
    throw new ORPCError("CONFLICT", { message: "This household already has a card subscription. Manage it in Settings → Billing." });
  }
  const me = await buyer(db, p.userId);
  const price = await priceFor(db, p.householdId, config);
  const amountIdr = price.priceIdr[input.interval];
  const id = buildOrderId();
  await db.insert(o).values({
    id,
    householdId: p.householdId,
    userId: p.userId,
    provider: "doku",
    interval: input.interval,
    months: planMonths(input.interval),
    amount: amountIdr * 100,
    currency: "IDR",
    priceTier: price.tier,
    isTest: doku.sandbox,
  });
  try {
    const { paymentUrl } = await createCheckout(doku, {
      orderId: id,
      amountIdr,
      itemName: input.interval === "yearly" ? "JoyoArto Pro 1 tahun" : "JoyoArto Pro 1 bulan",
      customerEmail: me.email,
      customerName: me.name,
      notifyUrl: `${config.apiUrl}${WEBHOOK_TARGET}`,
      returnUrl: `${config.appUrl}/payment?order=${encodeURIComponent(id)}`,
    });
    await db.update(o).set({ paymentUrl }).where(eq(o.id, id));
    return { orderId: id, paymentUrl };
  } catch (error) {
    console.error(`doku checkout ${id} failed:`, error);
    await db.update(o).set({ status: "failed" }).where(eq(o.id, id));
    throw new ORPCError("BAD_GATEWAY", { message: "Couldn't open the payment page. Try again in a moment." });
  }
}

/**
 * Pays a pending DOKU order: flips it to paid and stacks its months on the household's Pro time, in one D1 batch. The
 * flip lands only while the order is pending AND the DOKU entitlement still ends where we extended from, so a replayed
 * or concurrent notification extends exactly once.
 */
export async function activateDokuOrder(
  db: Database,
  config: Pick<BillingConfig, "trialDays" | "grandfather">,
  orderId: string,
  now = new Date(),
): Promise<"activated" | "already" | "failed" | "conflict" | "not_found"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [order] = await db.select().from(o).where(eq(o.id, orderId));
    if (!order || !order.householdId) return "not_found";
    if (order.status === "paid") return "already";
    if (order.status !== "pending") return "failed";
    const householdId = order.householdId;
    await db.insert(e).values({ householdId, provider: "doku", status: "expired", periodEnd: null }).onConflictDoNothing();
    const [[current], [household]] = await db.batch([
      db
        .select({ periodEnd: e.periodEnd })
        .from(e)
        .where(and(eq(e.householdId, householdId), eq(e.provider, "doku"))),
      db.select({ createdAt: schema.household.createdAt }).from(schema.household).where(eq(schema.household.id, householdId)),
    ]);
    const previous = current?.periodEnd ?? null;
    const free = household ? freeTimeEnd(config, household.createdAt) : null;
    const base = [previous, free?.end ?? null].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const until = nextPeriodEnd(base, now, order.months);
    const previousMs = previous?.getTime() ?? null;
    const [flipped] = await db.batch([
      db
        .update(o)
        .set({ status: "paid", paidAt: now, periodEnd: until })
        .where(
          and(
            eq(o.id, orderId),
            eq(o.status, "pending"),
            sql`(select ${e.periodEnd} from ${e} where ${e.householdId} = ${householdId} and ${e.provider} = 'doku') is ${previousMs}`,
          ),
        )
        .returning({ id: o.id }),
      db
        .update(e)
        .set({ status: "active", periodEnd: until, interval: order.interval, cancelAtPeriodEnd: false, updatedAt: now })
        .where(
          and(
            eq(e.householdId, householdId),
            eq(e.provider, "doku"),
            sql`exists (select 1 from ${o} where ${o.id} = ${orderId} and ${o.status} = 'paid' and ${o.paidAt} = ${now.getTime()})`,
          ),
        ),
    ]);
    if (flipped.length === 1) return "activated";
  }
  return "conflict";
}

export async function markOrderFailed(db: Database, orderId: string) {
  await db
    .update(o)
    .set({ status: "failed" })
    .where(and(eq(o.id, orderId), eq(o.status, "pending")));
}

export const orderIdInput = z.object({ id: z.string().min(1).max(80) });

/** One of the household's orders (the payment page polls this until the webhook lands). */
export async function getOrder(db: Database, p: Principal, id: string) {
  const [row] = await db
    .select()
    .from(o)
    .where(and(eq(o.id, id), eq(o.householdId, p.householdId)));
  return orderView(row ?? notFound("Order"));
}

/** "Check payment": ask DOKU now instead of waiting for the webhook, and settle the order if it was paid. */
export async function checkOrder(db: Database, p: Principal, config: BillingConfig | undefined, id: string, now = new Date()) {
  const order = await getOrder(db, p, id);
  if (order.status !== "pending" || order.provider !== "doku" || !config?.doku) return order;
  try {
    const n = await checkStatus(config.doku, id);
    if (n.status === "EXPIRED") await markOrderFailed(db, id);
    else if (isPaid(n) && Math.round(n.amount) * 100 === order.amount) await activateDokuOrder(db, config, id, now);
  } catch (error) {
    // DOKU answers Not Found until the buyer picks a payment channel.
    console.error(`doku check ${id}:`, error instanceof Error ? error.message : error);
  }
  return getOrder(db, p, id);
}

// ------------------------------------------------------------------------------------------------ Polar

/** USD card subscription (Polar). The household is Polar's customer, so any member can manage it later. */
export async function startPolarCheckout(db: Database, p: Principal, config: BillingConfig | undefined, input: z.infer<typeof checkoutInput>, customerIp?: string | null) {
  const polar = config?.polar;
  if (!config || !polar) throw new ORPCError("NOT_FOUND", { message: "Paying in US dollars is not available on this server." });
  const [live] = await db
    .select({ status: e.status })
    .from(e)
    .where(and(eq(e.householdId, p.householdId), eq(e.provider, "polar"), inArray(e.status, ["active", "past_due", "canceled"]), gte(e.periodEnd, new Date())));
  if (live) throw new ORPCError("CONFLICT", { message: "This household already has a card subscription. Manage it from Settings → Billing." });
  const me = await buyer(db, p.userId);
  try {
    return await createPolarCheckout(polar, {
      interval: input.interval,
      householdId: p.householdId,
      userId: p.userId,
      email: me.email,
      name: me.name,
      successUrl: `${config.appUrl}/payment?polar=success`,
      returnUrl: `${config.appUrl}/pricing`,
      customerIp,
    });
  } catch (error) {
    console.error(`polar checkout for ${p.householdId} failed:`, error);
    throw new ORPCError("BAD_GATEWAY", { message: "Couldn't open the checkout. Try again in a moment." });
  }
}

/** Polar's customer portal: cancel, change plan, card, invoices. */
export async function polarPortal(db: Database, p: Principal, config: BillingConfig | undefined) {
  const polar = config?.polar;
  if (!config || !polar) throw new ORPCError("NOT_FOUND", { message: "Card subscriptions are not available on this server." });
  const [row] = await db
    .select({ status: e.status })
    .from(e)
    .where(and(eq(e.householdId, p.householdId), eq(e.provider, "polar")));
  if (!row) notFound("Card subscription");
  try {
    return await createPolarPortal(polar, { householdId: p.householdId, returnUrl: `${config.appUrl}/settings` });
  } catch (error) {
    console.error(`polar portal for ${p.householdId} failed:`, error);
    throw new ORPCError("BAD_GATEWAY", { message: "Couldn't open the subscription portal. Try again in a moment." });
  }
}
