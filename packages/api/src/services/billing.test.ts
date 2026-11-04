import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Principal } from "../context";
import { billingConfig } from "../lib/billing/config";
import type { BillingConfig } from "../lib/billing/config";
import { freeTimeEnd, localEntitlement, resolveEntitlement } from "../lib/billing/entitlement";
import {
  FAIL_OPEN_MS,
  FREE_CACHE_MS,
  JOYO_INTERNAL_KEY_HEADER,
  JoyoProUnauthorized,
  JoyoProUnavailable,
  PRO_CACHE_MS,
  cacheRow,
  failOpen,
  fetchJoyoPro,
} from "../lib/billing/joyo-pro";
import { sampleGopayText, sampleJagoText } from "../lib/statements/sample";
import { testDb, testPrincipal } from "../test/d1";
import {
  assertMemberSeat,
  assertScenarioSlot,
  assertStatementImport,
  billingStatus,
  chatCap,
  joyoStatus,
  publicPricing,
  requireFeature,
  resetJoyoProCaches,
  userPlan,
} from "./billing";
import { createInvite } from "./household";
import { saveScenario } from "./scenarios";
import { importStatement } from "./statements";

const DAY = 86_400_000;
const ROGO = "https://rogo.test";
const KEY = "internal-test-key";

function config(over: Partial<BillingConfig> = {}): BillingConfig {
  return {
    enforced: true,
    joyo: { apiUrl: ROGO, key: KEY },
    proUrl: `${ROGO}/pro?from=joyoarto`,
    // No trial by default, so a fresh test user is on Free unless JoyoRogo says Pro.
    trialDays: 0,
    grandfather: null,
    proEmails: [],
    ...over,
  };
}

type Answer = { pro: boolean; until: string | null; plan: string | null; source: string | null };

/** A stand-in for JoyoRogo's server: Joyo Pro by Google account id or by email, and its public config. */
class FakeRogo {
  bySub = new Map<string, Answer>();
  byEmail = new Map<string, Answer>();
  /** "down" = network error; a number = that HTTP status. */
  fail: "down" | number | null = null;
  calls: { path: string; key: string | null; body: { googleSub?: string; email?: string } | null }[] = [];
  config: unknown = {
    founderPriceIdr: 15_000,
    founderYearlyPriceIdr: 149_000,
    promo: { slots: 10, taken: 3, nextPriceIdr: 29_000 },
    usd: { monthlyCents: 999, yearlyCents: 5999, preferred: false, country: null },
    myr: null,
    sgd: null,
  };

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as { googleSub?: string; email?: string }) : null;
    const key = (init?.headers as Record<string, string> | undefined)?.[JOYO_INTERNAL_KEY_HEADER] ?? null;
    this.calls.push({ path: url.pathname, key, body });
    if (this.fail === "down") throw new TypeError("fetch failed");
    if (typeof this.fail === "number") return new Response("{}", { status: this.fail });
    if (url.pathname === "/api/config") return Response.json(this.config);
    if (key !== KEY) return Response.json({ error: "unauthorized" }, { status: 401 });
    const answer = (body?.googleSub && this.bySub.get(body.googleSub)) || (body?.email && this.byEmail.get(body.email)) || null;
    return Response.json(answer ?? { pro: false, until: null, plan: null, source: null });
  }) as typeof fetch;

  statusCalls() {
    return this.calls.filter((c) => c.path === "/api/internal/joyo-pro/status").length;
  }
}

let db: Database;
let cfg: BillingConfig;
let rogo: FakeRogo;
const realFetch = globalThis.fetch;
const realError = console.error;

beforeEach(async () => {
  ({ db } = await testDb());
  cfg = config();
  rogo = new FakeRogo();
  globalThis.fetch = rogo.fetch;
  resetJoyoProCaches();
  console.error = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

/** Signs the user in with Google (better-auth's account row) and marks the email verified, as Google sign-in does. */
async function withGoogle(p: Principal, sub: string) {
  await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: sub, providerId: "google", userId: p.userId, updatedAt: new Date() });
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, p.userId));
}

async function emailOf(p: Principal) {
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, p.userId));
  return u!.email;
}

function proUntil(until: Date, plan = "monthly"): Answer {
  return { pro: true, until: until.toISOString(), plan, source: "doku" };
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

// ------------------------------------------------------------------------------------------------ config

describe("billing config", () => {
  test("no JOYO_INTERNAL_KEY = billing off; limits need PAYWALL=1 too", () => {
    expect(billingConfig({ PAYWALL: "1" })).toMatchObject({ enforced: false, joyo: null });
    expect(billingConfig({ JOYO_INTERNAL_KEY: "k" }).enforced).toBe(false);
    const on = billingConfig({ PAYWALL: "1", JOYO_INTERNAL_KEY: " k " });
    expect(on).toMatchObject({ enforced: true, joyo: { apiUrl: "https://api.joyorogo.com", key: "k" }, trialDays: 14 });
    expect(on.proUrl).toBe("https://app.joyorogo.com/pro?from=joyoarto");
  });

  test("URLs, grandfather date and allow-list come from vars; typos are loud", () => {
    const c = billingConfig({
      JOYO_INTERNAL_KEY: "k",
      JOYOROGO_API_URL: "https://api.example.test/",
      JOYO_PRO_URL: "https://example.test/harga?x=1",
      PRO_GRANDFATHER_CREATED_BEFORE: "2026-11-05",
      PRO_GRANDFATHER_UNTIL: "2027-02-01",
      PRO_EMAILS: "A@x.com",
      ADMIN_EMAILS: "b@x.com",
    });
    expect(c.joyo?.apiUrl).toBe("https://api.example.test");
    expect(c.proUrl).toBe("https://example.test/harga?x=1&from=joyoarto");
    expect(c.grandfather?.until.toISOString()).toBe("2027-01-31T17:00:00.000Z");
    expect(c.proEmails).toEqual(["a@x.com", "b@x.com"]);
    expect(() => billingConfig({ PRO_TRIAL_DAYS: "two" })).toThrow();
    expect(() => billingConfig({ JOYO_INTERNAL_KEY: "k", JOYOROGO_API_URL: "api.joyorogo.com" })).toThrow();
    expect(() => billingConfig({ PRO_GRANDFATHER_CREATED_BEFORE: "5 Nov", PRO_GRANDFATHER_UNTIL: "2027-02-01" })).toThrow();
  });
});

// ------------------------------------------------------------------------------------------------ client

describe("Joyo Pro client", () => {
  const joyo = { apiUrl: ROGO, key: KEY };

  test("sends the key, the Google account id and the email; reads the answer", async () => {
    rogo.bySub.set("g-1", proUntil(new Date("2026-12-04T00:00:00Z"), "yearly"));
    const answer = await fetchJoyoPro(joyo, { googleSub: "g-1", email: "a@x.com" }, rogo.fetch);
    expect(answer).toEqual({ pro: true, until: new Date("2026-12-04T00:00:00Z"), plan: "yearly", source: "doku" });
    expect(rogo.calls[0]).toEqual({ path: "/api/internal/joyo-pro/status", key: KEY, body: { googleSub: "g-1", email: "a@x.com" } });
    // Without a Google account only the email is sent.
    await fetchJoyoPro(joyo, { googleSub: null, email: "a@x.com" }, rogo.fetch);
    expect(rogo.calls[1]!.body).toEqual({ email: "a@x.com" });
  });

  test("a wrong key is JoyoProUnauthorized; outages and garbage are JoyoProUnavailable", async () => {
    await expect(fetchJoyoPro({ ...joyo, key: "wrong" }, { googleSub: "g", email: "a@x.com" }, rogo.fetch)).rejects.toBeInstanceOf(JoyoProUnauthorized);
    rogo.fail = 503;
    await expect(fetchJoyoPro(joyo, { googleSub: "g", email: "a@x.com" }, rogo.fetch)).rejects.toBeInstanceOf(JoyoProUnavailable);
    rogo.fail = "down";
    await expect(fetchJoyoPro(joyo, { googleSub: "g", email: "a@x.com" }, rogo.fetch)).rejects.toBeInstanceOf(JoyoProUnavailable);
    const garbage = (async () => Response.json({ hello: 1 })) as unknown as typeof fetch;
    await expect(fetchJoyoPro(joyo, { googleSub: "g", email: "a@x.com" }, garbage)).rejects.toBeInstanceOf(JoyoProUnavailable);
    const odd = (async () => Response.json({ pro: true, until: null, plan: "weekly", source: null })) as unknown as typeof fetch;
    expect((await fetchJoyoPro(joyo, { googleSub: "g", email: "a@x.com" }, odd)).plan).toBeNull();
  });
});

describe("cache rules", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const until = new Date("2026-12-10T00:00:00Z");

  test("Pro is trusted for 10 minutes, not-Pro for 2", () => {
    expect(cacheRow({ pro: true, until, plan: "monthly", source: "doku" }, undefined, now).expiresAt.getTime()).toBe(now.getTime() + PRO_CACHE_MS);
    expect(cacheRow({ pro: false, until: null, plan: null, source: null }, undefined, now).expiresAt.getTime()).toBe(now.getTime() + FREE_CACHE_MS);
    // A Pro answer whose end already passed counts as not-Pro.
    expect(cacheRow({ pro: true, until: new Date(now.getTime() - 1), plan: "monthly", source: null }, undefined, now).expiresAt.getTime()).toBe(now.getTime() + FREE_CACHE_MS);
  });

  test("fail-open: at most 24 h past the last confirmed end, never for the never-Pro, and a lifetime grant stays", () => {
    const row = cacheRow({ pro: true, until, plan: "monthly", source: "doku" }, undefined, now);
    // A later not-Pro answer keeps the last confirmed end.
    const lapsed = cacheRow({ pro: false, until: null, plan: null, source: null }, row, now);
    expect(lapsed.lastProUntil).toEqual(until);
    expect(failOpen(lapsed, new Date(until.getTime() + FAIL_OPEN_MS - 1))).toEqual({ pro: true, until });
    expect(failOpen(lapsed, new Date(until.getTime() + FAIL_OPEN_MS))).toEqual({ pro: false, until: null });
    expect(failOpen(undefined, now)).toEqual({ pro: false, until: null });
    expect(failOpen(cacheRow({ pro: false, until: null, plan: null, source: null }, undefined, now), now).pro).toBe(false);
    const lifetime = cacheRow({ pro: true, until: null, plan: "lifetime", source: "comp" }, undefined, now);
    expect(failOpen(lifetime, new Date(now.getTime() + 30 * DAY))).toEqual({ pro: true, until: null });
    // A revoked lifetime grant does not come back.
    expect(failOpen(cacheRow({ pro: false, until: null, plan: null, source: null }, lifetime, now), now).pro).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ status

describe("Joyo Pro status", () => {
  test("matches by the Google account id first", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "google-sub-1");
    const until = new Date(Date.now() + 20 * DAY);
    rogo.bySub.set("google-sub-1", proUntil(until));
    const plan = await userPlan(db, p.userId, cfg);
    expect(plan.entitlement).toEqual({ plan: "pro", source: "joyo", until });
    expect(rogo.calls[0]!.body).toEqual({ googleSub: "google-sub-1", email: await emailOf(p) });
  });

  test("falls back to the verified email; an unverified email without Google is never sent", async () => {
    const p = await testPrincipal(db);
    rogo.byEmail.set(await emailOf(p), proUntil(new Date(Date.now() + DAY)));
    // testPrincipal's email is not verified and has no Google account: Free, JoyoRogo not asked.
    expect((await userPlan(db, p.userId, cfg)).entitlement.plan).toBe("free");
    expect(rogo.statusCalls()).toBe(0);
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, p.userId));
    resetJoyoProCaches();
    expect((await userPlan(db, p.userId, cfg)).entitlement).toMatchObject({ plan: "pro", source: "joyo" });
    expect(rogo.calls.at(-1)!.body).toEqual({ email: await emailOf(p) });
  });

  test("answers are cached: 10 minutes for Pro, 2 for not-Pro", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "g-cache");
    const t0 = new Date();
    rogo.bySub.set("g-cache", proUntil(new Date(t0.getTime() + 30 * DAY)));
    await joyoStatus(db, p.userId, cfg, t0);
    await joyoStatus(db, p.userId, cfg, new Date(t0.getTime() + PRO_CACHE_MS - 1));
    expect(rogo.statusCalls()).toBe(1);
    // Cancelled and refunded in JoyoRogo: seen after the Pro answer expires.
    rogo.bySub.delete("g-cache");
    const t1 = new Date(t0.getTime() + PRO_CACHE_MS);
    expect((await joyoStatus(db, p.userId, cfg, t1))!.pro).toBe(false);
    expect(rogo.statusCalls()).toBe(2);
    await joyoStatus(db, p.userId, cfg, new Date(t1.getTime() + FREE_CACHE_MS - 1));
    expect(rogo.statusCalls()).toBe(2);
    await joyoStatus(db, p.userId, cfg, new Date(t1.getTime() + FREE_CACHE_MS));
    expect(rogo.statusCalls()).toBe(3);
  });

  test("JoyoRogo unreachable: Pro users keep Pro for at most 24 h past their end; never-Pro users get nothing", async () => {
    const pro = await testPrincipal(db, "Pro");
    const never = await testPrincipal(db, "Never");
    await withGoogle(pro, "g-pro");
    await withGoogle(never, "g-never");
    const t0 = new Date();
    const until = new Date(t0.getTime() + DAY);
    rogo.bySub.set("g-pro", proUntil(until));
    await joyoStatus(db, pro.userId, cfg, t0);
    await joyoStatus(db, never.userId, cfg, t0);

    rogo.fail = "down";
    const later = new Date(until.getTime() + 23 * 3_600_000);
    expect(await joyoStatus(db, pro.userId, cfg, later)).toMatchObject({ pro: true, stale: true, until });
    expect((await userPlan(db, pro.userId, cfg, { now: later })).entitlement.plan).toBe("pro");
    expect(await joyoStatus(db, never.userId, cfg, later)).toMatchObject({ pro: false, stale: true });

    resetJoyoProCaches();
    const tooLate = new Date(until.getTime() + FAIL_OPEN_MS + 1);
    expect((await userPlan(db, pro.userId, cfg, { now: tooLate })).entitlement.plan).toBe("free");
    // A user JoyoArto never heard about while JoyoRogo is down: Free.
    const fresh = await testPrincipal(db, "Fresh");
    await withGoogle(fresh, "g-fresh");
    expect((await userPlan(db, fresh.userId, cfg, { now: later })).entitlement.plan).toBe("free");
  });

  test("an outage is not asked again for a minute (no 3 s timeout on every request)", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "g-backoff");
    rogo.fail = "down";
    const t0 = new Date();
    await joyoStatus(db, p.userId, cfg, t0);
    await joyoStatus(db, p.userId, cfg, new Date(t0.getTime() + 59_000));
    expect(rogo.statusCalls()).toBe(1);
    rogo.fail = null;
    await joyoStatus(db, p.userId, cfg, new Date(t0.getTime() + 60_001));
    expect(rogo.statusCalls()).toBe(2);
  });

  test("a wrong key is logged and treated like an outage: nobody is locked out, nobody gains Pro", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "g-key");
    const t0 = new Date();
    rogo.bySub.set("g-key", proUntil(new Date(t0.getTime() + DAY)));
    await joyoStatus(db, p.userId, cfg, t0);
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    resetJoyoProCaches();
    const wrong = config({ joyo: { apiUrl: ROGO, key: "wrong" } });
    const after = new Date(t0.getTime() + PRO_CACHE_MS + 1);
    expect(await joyoStatus(db, p.userId, wrong, after)).toMatchObject({ pro: true, stale: true });
    expect(String(logged[0])).toContain("JOYO_INTERNAL_KEY");
    const other = await testPrincipal(db, "Other");
    await withGoogle(other, "g-other");
    expect((await joyoStatus(db, other.userId, wrong, after))!.pro).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ plan resolution

describe("plan resolution", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const base = config({ trialDays: 14, grandfather: { createdBefore: new Date("2026-11-04T17:00:00Z"), until: new Date("2027-01-31T17:00:00Z") } });

  test("self-host, allow-list, grandfathered, trial, Free", () => {
    const local = (over: Partial<BillingConfig>, createdAt: Date, email = "a@x.com") => localEntitlement({ config: { ...base, ...over }, email, userCreatedAt: createdAt, now });
    expect(local({ enforced: false }, now)).toEqual({ plan: "pro", source: "selfhost", until: null });
    expect(local({ proEmails: ["a@x.com"] }, now, " A@x.com")).toEqual({ plan: "pro", source: "grant", until: null });
    expect(local({}, new Date("2026-10-01T00:00:00Z"))).toMatchObject({ source: "grandfather", until: new Date("2027-01-31T17:00:00Z") });
    expect(local({}, new Date("2026-11-08T00:00:00Z"))).toMatchObject({ source: "trial", until: new Date("2026-11-22T00:00:00Z") });
    expect(local({}, new Date("2026-10-20T00:00:00Z"), "a@x.com")).toMatchObject({ source: "grandfather" });
    expect(local({ grandfather: null }, new Date("2026-10-20T00:00:00Z"))).toBeNull();
    expect(freeTimeEnd({ trialDays: 0, grandfather: null }, now)).toBeNull();
  });

  test("Joyo Pro wins over local free time; Free when neither", () => {
    const trial = { plan: "pro" as const, source: "trial" as const, until: new Date("2026-11-22T00:00:00Z") };
    const joyoUntil = new Date("2027-11-10T00:00:00Z");
    expect(resolveEntitlement(trial, { pro: true, until: joyoUntil })).toEqual({ plan: "pro", source: "joyo", until: joyoUntil });
    expect(resolveEntitlement(trial, { pro: false, until: null })).toEqual(trial);
    expect(resolveEntitlement(null, null)).toEqual({ plan: "free", source: "free", until: null });
    expect(resolveEntitlement({ plan: "pro", source: "grant", until: null }, { pro: false, until: null }).source).toBe("grant");
  });

  test("limit checks skip JoyoRogo during the trial; Settings asks it anyway", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "g-trial");
    const c = config({ trialDays: 14 });
    expect((await userPlan(db, p.userId, c)).entitlement.source).toBe("trial");
    expect(rogo.statusCalls()).toBe(0);
    const status = await billingStatus(db, p, c, 30);
    expect(status.entitlement.source).toBe("trial");
    expect(status.joyo).toMatchObject({ pro: false, stale: false });
    expect(status.proUrl).toBe(`${ROGO}/pro?from=joyoarto`);
    expect(rogo.statusCalls()).toBe(1);
  });

  test("billing off (self-host, no key): everyone is Pro and JoyoRogo is never asked", async () => {
    const p = await testPrincipal(db);
    for (const off of [undefined, billingConfig({ PAYWALL: "1" }), config({ enforced: false })]) {
      expect((await userPlan(db, p.userId, off)).entitlement.source).toBe("selfhost");
      await requireFeature(db, p.userId, off, "mcpConnector");
      expect(await chatCap(db, p.userId, off, 30)).toEqual({ cap: 30, plan: "pro" });
    }
    expect(rogo.calls.length).toBe(0);
    expect(await publicPricing(undefined, 30)).toMatchObject({ available: false, prices: null, proUrl: null });
    expect((await billingStatus(db, p, undefined, 30)).proUrl).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ prices

describe("pricing", () => {
  test("JoyoRogo's prices and promo are passed through; an outage shows no prices", async () => {
    const pricing = await publicPricing(cfg, 30);
    expect(pricing).toMatchObject({
      available: true,
      proUrl: `${ROGO}/pro?from=joyoarto`,
      prices: { idr: { monthly: 15_000, yearly: 149_000 }, promo: { slots: 10, taken: 3, nextPriceIdr: 29_000 }, usdCents: { monthly: 999, yearly: 5999 }, myrSen: null },
    });
    // Cached: a second page view does not ask again.
    await publicPricing(cfg, 30);
    expect(rogo.calls.filter((c) => c.path === "/api/config").length).toBe(1);
    resetJoyoProCaches();
    rogo.fail = "down";
    expect((await publicPricing(cfg, 30)).prices).toBeNull();
    resetJoyoProCaches();
    rogo.fail = null;
    rogo.config = { founderPriceIdr: 49_000, founderYearlyPriceIdr: 349_000, promo: null, usd: null };
    expect((await publicPricing(cfg, 30)).prices).toEqual({ idr: { monthly: 49_000, yearly: 349_000 }, promo: null, usdCents: null, myrSen: null, sgdCents: null });
  });
});

// ------------------------------------------------------------------------------------------------ limits

describe("Free limits follow the acting user", () => {
  test("statement imports: two a month per user, counted when rows are saved", async () => {
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

  test("two members of one household: the Pro one is unlimited, the Free one is not", async () => {
    const owner = await testPrincipal(db, "Owner");
    await withGoogle(owner, "g-owner");
    rogo.bySub.set("g-owner", proUntil(new Date(Date.now() + 30 * DAY)));
    const partnerId = crypto.randomUUID();
    await db.insert(schema.user).values({ id: partnerId, name: "Partner", email: `${partnerId}@example.com` });
    await db.insert(schema.householdMember).values({ householdId: owner.householdId, userId: partnerId, role: "member" });
    const partner: Principal = { ...owner, userId: partnerId };
    const period = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    for (const userId of [owner.userId, partnerId]) await db.insert(schema.usageCounter).values({ userId, metric: "statement_import", period, count: 50 });

    await assertStatementImport(db, owner.userId, cfg);
    await expectUpgrade(assertStatementImport(db, partner.userId, cfg), "statementImports");
    await requireFeature(db, owner.userId, cfg, "mcpConnector");
    await expectUpgrade(requireFeature(db, partner.userId, cfg, "emailImport"), "emailImport");
    expect(await chatCap(db, owner.userId, cfg, 30)).toEqual({ cap: 30, plan: "pro" });
    expect(await chatCap(db, partner.userId, cfg, 30)).toEqual({ cap: 5, plan: "free" });
    expect(await chatCap(db, partner.userId, cfg, 3)).toEqual({ cap: 3, plan: "free" });
    expect((await billingStatus(db, partner, cfg, 30)).plan).toBe("free");
    expect((await billingStatus(db, owner, cfg, 30)).plan).toBe("pro");
  });

  test("members: the inviter's plan decides, pending invites included", async () => {
    const p = await testPrincipal(db);
    await withGoogle(p, "g-inviter");
    await createInvite(db, p, { email: "partner@example.com", role: "member" }, cfg);
    // Re-inviting the same address takes no new seat.
    await createInvite(db, p, { email: "partner@example.com", role: "member" }, cfg);
    await expectUpgrade(createInvite(db, p, { email: "nanny@example.com", role: "member" }, cfg), "members");
    rogo.bySub.set("g-inviter", proUntil(new Date(Date.now() + 30 * DAY)));
    resetJoyoProCaches();
    await db.delete(schema.joyoProStatus);
    await createInvite(db, p, { email: "nanny@example.com", role: "member" }, cfg);
    // An invite without a known inviter falls back to the Free limit; billing off allows Pro's.
    await expectUpgrade(assertMemberSeat(db, p.householdId, null, cfg, { countPending: true }), "members");
    await expect(assertMemberSeat(db, p.householdId, null, undefined, { countPending: true })).resolves.toBeUndefined();
  });

  test("saved scenarios are Pro; editing one saved before stays allowed", async () => {
    const p = await testPrincipal(db);
    const plan = { items: [] };
    await expectUpgrade(saveScenario(db, p, { name: "Car", plan } as never, cfg), "savedScenarios");
    const saved = await saveScenario(db, p, { name: "Car", plan } as never, undefined);
    const again = await saveScenario(db, p, { id: saved.scenario.id, name: "Car", plan } as never, cfg);
    expect(again.created).toBe(false);
    await expectUpgrade(assertScenarioSlot(db, p.userId, cfg, 1), "savedScenarios");
  });

  test("the owner's allow-list makes that account Pro without asking JoyoRogo", async () => {
    const owner = await testPrincipal(db, "Owner");
    const other = await testPrincipal(db, "Other");
    const c = config({ proEmails: [await emailOf(owner)] });
    expect((await userPlan(db, owner.userId, c)).entitlement.source).toBe("grant");
    expect((await userPlan(db, other.userId, c)).entitlement.plan).toBe("free");
    expect(rogo.statusCalls()).toBe(0);
  });
});
