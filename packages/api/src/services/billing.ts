// JoyoArto's side of Joyo Pro: which plan the acting user is on, the Free limits, and what Settings → Billing and the
// pricing page show. Joyo Pro is one subscription per ACCOUNT, sold and managed by JoyoRogo (the only billing
// authority); JoyoArto asks it (lib/billing/joyo-pro.ts), caches the answer per user, and sells nothing itself.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import type { Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { isDemoUser } from "../lib/demo";
import { localEntitlement, resolveEntitlement, wibMonth } from "../lib/billing/entitlement";
import type { Entitlement } from "../lib/billing/entitlement";
import {
  JoyoProAppleRefused,
  JoyoProUnauthorized,
  answerIsPro,
  cacheRow,
  failOpen,
  fetchAppleAccountToken,
  fetchJoyoPricing,
  fetchJoyoPro,
  redeemAppleTransaction,
} from "../lib/billing/joyo-pro";
import type { CachedJoyoPro, JoyoPricing } from "../lib/billing/joyo-pro";
import { PLAN_LIMITS, STATEMENT_IMPORT_METRIC } from "../lib/billing/plans";
import type { PlanLimits, UpgradeFeature } from "../lib/billing/plans";

const jp = schema.joyoProStatus;
const hm = schema.householdMember;

/**
 * A Free limit was hit. FORBIDDEN with `data.upgrade`, so the web app shows its upgrade prompt (apps/web/src/lib/billing.ts)
 * and MCP/REST callers get a readable message.
 */
export function upgradeRequired(feature: UpgradeFeature, message: string, extra: Record<string, unknown> = {}): never {
  throw new ORPCError("FORBIDDEN", {
    message: `${message} Joyo Pro (bought in JoyoRogo with the same Google account) unlocks it; see Settings → Billing.`,
    data: { upgrade: true, feature, ...extra },
  });
}

// ------------------------------------------------------------------------------------------------ Joyo Pro status

/** JoyoRogo's view of a user, as JoyoArto last knew it. */
export type JoyoStatus = {
  pro: boolean;
  until: Date | null;
  plan: string | null;
  source: string | null;
  /** Last successful answer; null = never answered. */
  checkedAt: Date | null;
  /** JoyoRogo could not be asked just now: `pro` comes from the fail-open rule. */
  stale: boolean;
};

/** Users whose last call failed, and until when not to try again (per isolate): an outage must not add 3 s to every request. */
const backoff = new Map<string, number>();
const BACKOFF_MS = 60_000;

/** Tests only. */
export function resetJoyoProCaches() {
  backoff.clear();
  pricingCache = null;
}

async function identity(db: Database, userId: string): Promise<{ email: string; emailVerified: boolean; googleSub: string | null; createdAt: Date } | null> {
  const [[u], [google]] = await db.batch([
    db.select({ email: schema.user.email, emailVerified: schema.user.emailVerified, createdAt: schema.user.createdAt }).from(schema.user).where(eq(schema.user.id, userId)),
    db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "google")))
      .limit(1),
  ]);
  return u ? { ...u, googleSub: google?.accountId ?? null } : null;
}

function fromRow(row: CachedJoyoPro, now: Date): JoyoStatus {
  return { pro: answerIsPro(row, now), until: row.until, plan: row.plan, source: row.source, checkedAt: row.checkedAt, stale: false };
}

/**
 * Joyo Pro for a user: the cached answer while it is fresh (10 min for Pro, 2 min for not-Pro), else JoyoRogo's.
 * Unreachable JoyoRogo (or a refused key) never locks out someone it confirmed, for at most 24 h past the last end it
 * confirmed; someone it never confirmed stays not-Pro.
 */
export async function joyoStatus(db: Database, userId: string, config: BillingConfig, now = new Date()): Promise<JoyoStatus | null> {
  const joyo = config.joyo;
  if (!joyo) return null;
  const [cached] = await db.select().from(jp).where(eq(jp.userId, userId));
  if (cached && cached.expiresAt.getTime() > now.getTime()) return fromRow(cached, now);

  const stale = (): JoyoStatus => ({ ...failOpen(cached, now), plan: cached?.plan ?? null, source: cached?.source ?? null, checkedAt: cached?.checkedAt ?? null, stale: true });
  if ((backoff.get(userId) ?? 0) > now.getTime()) return stale();

  const who = await identity(db, userId);
  if (!who) return null;
  // Only a verified email may stand in for the Google account id (sign-in is Google, so this is the normal case).
  if (!who.googleSub && !who.emailVerified) return { pro: false, until: null, plan: null, source: null, checkedAt: null, stale: false };
  try {
    const answer = await fetchJoyoPro(joyo, { googleSub: who.googleSub, email: who.emailVerified ? who.email : "" });
    const row = cacheRow(answer, cached, now);
    await db
      .insert(jp)
      .values({ userId, ...row })
      .onConflictDoUpdate({ target: jp.userId, set: row });
    backoff.delete(userId);
    return fromRow(row, now);
  } catch (error) {
    if (error instanceof JoyoProUnauthorized) console.error(error.message);
    else console.error(`joyo-pro status for ${userId}:`, error instanceof Error ? error.message : error);
    backoff.set(userId, now.getTime() + BACKOFF_MS);
    return stale();
  }
}

// ------------------------------------------------------------------------------------------------ plan

export type UserPlan = { entitlement: Entitlement; limits: PlanLimits; joyo: JoyoStatus | null };

const SELF_HOST: UserPlan = { entitlement: { plan: "pro", source: "selfhost", until: null }, limits: PLAN_LIMITS.pro, joyo: null };
const DEMO: UserPlan = { entitlement: { plan: "pro", source: "grant", until: null }, limits: PLAN_LIMITS.pro, joyo: null };

/**
 * The user's plan now. Without billing (self-host, tests) everyone is Pro and nothing is read. `askJoyo: "always"`
 * fetches Joyo Pro even when a trial or grandfathering already grants Pro (Settings shows both); limit checks skip the
 * call then.
 */
export async function userPlan(
  db: Database,
  userId: string,
  config: BillingConfig | undefined,
  opts: { now?: Date; askJoyo?: "ifNeeded" | "always" } = {},
): Promise<UserPlan> {
  if (!config?.enforced) return SELF_HOST;
  // Store reviewers see everything.
  if (isDemoUser(userId)) return DEMO;
  const now = opts.now ?? new Date();
  const [u] = await db.select({ email: schema.user.email, createdAt: schema.user.createdAt }).from(schema.user).where(eq(schema.user.id, userId));
  const local = u ? localEntitlement({ config, email: u.email, userCreatedAt: u.createdAt, now }) : null;
  const decided = local && (opts.askJoyo !== "always" || local.source === "grant");
  const joyo = decided ? null : await joyoStatus(db, userId, config, now);
  const entitlement = resolveEntitlement(local, joyo);
  return { entitlement, limits: PLAN_LIMITS[entitlement.plan], joyo };
}

// ------------------------------------------------------------------------------------------------ limits

/** Pro-only features (email import, the Claude connector), for the acting user. */
export async function requireFeature(db: Database, userId: string, config: BillingConfig | undefined, feature: "emailImport" | "mcpConnector") {
  const { limits } = await userPlan(db, userId, config);
  if (limits[feature]) return;
  if (feature === "emailImport") upgradeRequired(feature, "Importing statements by email is part of Joyo Pro.");
  upgradeRequired(feature, "The Claude connector (MCP) is part of Joyo Pro.");
}

async function usage(db: Database, userId: string, metric: string, period: string): Promise<number> {
  const uc = schema.usageCounter;
  const [row] = await db
    .select({ count: uc.count })
    .from(uc)
    .where(and(eq(uc.userId, userId), eq(uc.metric, metric), eq(uc.period, period)));
  return row?.count ?? 0;
}

/** Before reading a statement: a Free user who used this month's imports gets the upgrade prompt (preview included). */
export async function assertStatementImport(db: Database, userId: string, config: BillingConfig | undefined, now = new Date()) {
  const { limits } = await userPlan(db, userId, config, { now });
  const limit = limits.statementImportsPerMonth;
  if (limit === null) return;
  const used = await usage(db, userId, STATEMENT_IMPORT_METRIC, wibMonth(now));
  if (used >= limit) {
    upgradeRequired("statementImports", `Free includes ${limit} statement imports a month and this month's are used.`, { limit, used });
  }
}

/** After a committed statement import that added rows. Counted on every plan, so a downgrade starts from the truth. */
export async function countStatementImport(db: Database, userId: string, now = new Date()) {
  const uc = schema.usageCounter;
  await db
    .insert(uc)
    .values({ userId, metric: STATEMENT_IMPORT_METRIC, period: wibMonth(now), count: 1, updatedAt: now })
    .onConflictDoUpdate({ target: [uc.userId, uc.metric, uc.period], set: { count: sql`${uc.count} + 1`, updatedAt: now } });
}

/**
 * Members plus pending invites must stay within the INVITER's plan (`inviterId`: who sends the invite, or who sent the
 * invite being accepted). Without a known inviter the Free limit applies.
 */
export async function assertMemberSeat(
  db: Database,
  householdId: string,
  inviterId: string | null,
  config: BillingConfig | undefined,
  opts: { countPending: boolean },
) {
  const { limits, entitlement } =
    inviterId || !config?.enforced ? await userPlan(db, inviterId ?? "", config) : { limits: PLAN_LIMITS.free, entitlement: { plan: "free" as const } };
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
  upgradeRequired("members", `On Free a household has up to ${limits.members} people (pending invites count); the inviter's plan decides.`, {
    limit: limits.members,
    used,
  });
}

/** Saving a new scenario (updating an existing one stays allowed, so nothing saved is lost after a downgrade). */
export async function assertScenarioSlot(db: Database, userId: string, config: BillingConfig | undefined, existing: number) {
  const { limits, entitlement } = await userPlan(db, userId, config);
  if (existing < limits.savedScenarios) return;
  if (entitlement.plan === "pro") {
    throw new ORPCError("BAD_REQUEST", { message: `A household can keep at most ${limits.savedScenarios} saved scenarios; delete some first.` });
  }
  upgradeRequired("savedScenarios", "Saving scenarios is part of Joyo Pro. Your draft stays on this device.", { limit: limits.savedScenarios });
}

/** Hosted Joyo AI questions for this user today: the plan's cap, never above the server's. */
export async function chatCap(db: Database, userId: string, config: BillingConfig | undefined, serverCap: number): Promise<{ cap: number; plan: "free" | "pro" }> {
  const { limits, entitlement } = await userPlan(db, userId, config);
  return { cap: limits.aiDailyCap === null ? serverCap : Math.min(limits.aiDailyCap, serverCap), plan: entitlement.plan };
}

// ------------------------------------------------------------------------------------------------ prices

const PRICING_CACHE_MS = 10 * 60_000;
let pricingCache: { at: number; value: JoyoPricing | null } | null = null;

/** JoyoRogo's current Joyo Pro prices (per isolate, 10 min); null when JoyoRogo does not answer. */
async function joyoPricing(config: BillingConfig, now: number): Promise<JoyoPricing | null> {
  if (!config.joyo) return null;
  if (pricingCache && now - pricingCache.at < PRICING_CACHE_MS) return pricingCache.value;
  let value: JoyoPricing | null = null;
  try {
    value = await fetchJoyoPricing(config.joyo.apiUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  // A failure is remembered for a minute only.
  pricingCache = { at: value ? now : now - PRICING_CACHE_MS + 60_000, value };
  return value;
}

/** Public: what Free and Pro include, JoyoRogo's prices and where to buy (no session needed). */
export async function publicPricing(config: BillingConfig | undefined, serverAiCap: number, now = Date.now()) {
  const limits = { free: PLAN_LIMITS.free, pro: { ...PLAN_LIMITS.pro, aiDailyCap: serverAiCap } };
  if (!config?.joyo) return { available: false, enforced: false, proUrl: null, prices: null, trialDays: 0, limits };
  return {
    available: true,
    enforced: config.enforced,
    proUrl: config.proUrl,
    prices: await joyoPricing(config, now),
    trialDays: config.trialDays,
    limits,
  };
}

// ------------------------------------------------------------------------------------------------ status

/** Settings → Billing: the signed-in user's plan, Joyo Pro as JoyoRogo reports it, and usage against the limits. */
export async function billingStatus(db: Database, p: Principal, config: BillingConfig | undefined, serverAiCap: number, now = new Date()) {
  const plan = await userPlan(db, p.userId, config, { now, askJoyo: "always" });
  const inv = schema.householdInvite;
  const [[members], [pending]] = await db.batch([
    db.select({ n: count() }).from(hm).where(eq(hm.householdId, p.householdId)),
    db
      .select({ n: count() })
      .from(inv)
      .where(and(eq(inv.householdId, p.householdId), isNull(inv.acceptedAt), gt(inv.expiresAt, now))),
  ]);
  const period = wibMonth(now);
  const used = await usage(db, p.userId, STATEMENT_IMPORT_METRIC, period);
  const limits = { ...plan.limits, aiDailyCap: plan.limits.aiDailyCap === null ? serverAiCap : Math.min(plan.limits.aiDailyCap, serverAiCap) };
  return {
    enforced: config?.enforced ?? false,
    plan: plan.entitlement.plan,
    entitlement: plan.entitlement,
    joyo: plan.joyo,
    /** JoyoRogo's Pro page: buy, renew or manage Joyo Pro there. Null without billing. */
    proUrl: config?.joyo ? config.proUrl : null,
    /** The iOS app's own Joyo Pro products (In-App Purchase); empty without billing. */
    appleProducts: config?.joyo ? APPLE_PRODUCTS : [],
    limits,
    usage: {
      statementImports: { used, limit: limits.statementImportsPerMonth, period },
      members: { used: (members?.n ?? 0) + (pending?.n ?? 0), limit: limits.members },
    },
  };
}

// ------------------------------------------------------------------------------------------------ App Store (iOS)

/** JoyoArto's auto-renewable subscriptions in App Store Connect (group "Joyo Pro"). JoyoRogo credits them as Joyo Pro. */
export const APPLE_PRODUCTS = [
  { id: "com.joyodigitama.joyoarto.pro.monthly", plan: "monthly" as const },
  { id: "com.joyodigitama.joyoarto.pro.yearly", plan: "yearly" as const },
];

function appleUnavailable(error: unknown): never {
  if (error instanceof JoyoProAppleRefused) throw new ORPCError("BAD_REQUEST", { message: error.message, data: { reason: error.reason } });
  if (error instanceof JoyoProUnauthorized) console.error(error.message);
  else console.error("joyo-pro apple:", error instanceof Error ? error.message : error);
  throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Joyo Pro can't be reached right now. Your purchase is safe: try again in a minute." });
}

async function appleWho(db: Database, userId: string) {
  const who = await identity(db, userId);
  if (!who || (!who.googleSub && !who.emailVerified)) {
    throw new ORPCError("BAD_REQUEST", { message: "Sign in with Apple or Google to subscribe to Joyo Pro." });
  }
  const [u] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
  return { googleSub: who.googleSub, email: who.email, name: u?.name ?? null };
}

/**
 * Before an App Store purchase: the appAccountToken to pass to StoreKit (null = buy without one: the demo, or a server
 * without billing).
 */
export async function appleAccountToken(db: Database, p: Principal, config: BillingConfig | undefined): Promise<{ appAccountToken: string | null }> {
  if (!config?.joyo || isDemoUser(p.userId)) return { appAccountToken: null };
  try {
    return { appAccountToken: await fetchAppleAccountToken(config.joyo, await appleWho(db, p.userId)) };
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    appleUnavailable(error);
  }
}

/**
 * After an App Store purchase, a restore, or a replay at start: JoyoRogo verifies the StoreKit 2 transaction and credits
 * Joyo Pro; the fresh answer replaces the cached status so the app shows Pro at once. The phone finishes the
 * transaction only after this succeeds.
 */
export async function redeemApplePurchase(
  db: Database,
  p: Principal,
  config: BillingConfig | undefined,
  signedTransaction: string,
  now = new Date(),
): Promise<{ status: "granted" | "already" | "inactive"; sandbox: boolean; pro: boolean }> {
  // Store reviewers buy in the Sandbox with the demo account, which is Pro already and has no JoyoRogo account.
  if (isDemoUser(p.userId)) return { status: "granted", sandbox: false, pro: true };
  if (!config?.joyo) throw new ORPCError("BAD_REQUEST", { message: "This server does not sell Joyo Pro." });
  try {
    const result = await redeemAppleTransaction(config.joyo, await appleWho(db, p.userId), signedTransaction);
    const [cached] = await db.select().from(jp).where(eq(jp.userId, p.userId));
    const row = cacheRow(result.joyo, cached, now);
    await db
      .insert(jp)
      .values({ userId: p.userId, ...row })
      .onConflictDoUpdate({ target: jp.userId, set: row });
    backoff.delete(p.userId);
    return { status: result.status, sandbox: result.sandbox, pro: answerIsPro(result.joyo, now) };
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    appleUnavailable(error);
  }
}
