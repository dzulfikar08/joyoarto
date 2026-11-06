import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { count, eq, sql } from "drizzle-orm";

import type { Context, Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { DEMO_HOUSEHOLD_ID, DEMO_USER_ID, demoCodeMatches } from "../lib/demo";
import { appRouter } from "../routers/index";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { savings } from "./savings";
import { userPlan } from "./billing";
import { demoLogin, demoRows, pruneDemoConnections, seedDemo, wibDate } from "./demo";
import { principalFromToken } from "./tokens";

let db: Database;
beforeEach(async () => {
  ({ db } = await testDb());
});

const NOW = new Date("2026-11-04T05:00:00Z");
const CODE = "review-2026";
const demo: Principal = { userId: DEMO_USER_ID, householdId: DEMO_HOUSEHOLD_ID, scopes: ["finance:read", "finance:write"], via: "session" };
const ctx = (principal: Principal | null, demoCode: string | null = CODE): Context => ({ db, principal, config: { importEmailDomain: "arto.example", demoCode } });

async function counts(householdId: string) {
  const n = async (table: typeof schema.finAccount | typeof schema.transaction | typeof schema.category | typeof schema.rule | typeof schema.budget | typeof schema.planScenario) =>
    (await db.select({ n: count() }).from(table).where(eq(table.householdId, householdId)))[0]!.n;
  const [sum] = await db.select({ s: sql<number>`coalesce(sum(${schema.transaction.amount}), 0)` }).from(schema.transaction).where(eq(schema.transaction.householdId, householdId));
  return {
    accounts: await n(schema.finAccount),
    transactions: await n(schema.transaction),
    categories: await n(schema.category),
    rules: await n(schema.rule),
    budgets: await n(schema.budget),
    scenarios: await n(schema.planScenario),
    sum: Number(sum?.s ?? 0),
  };
}

describe("made-up ledger", () => {
  test("about three months of rows, no account below zero, pending quick adds, only made-up names", () => {
    const rows = demoRows("2026-11-04");
    expect(rows[0]!.date).toBe("2026-08-01");
    expect(rows.every((r) => r.date >= "2026-08-01" && r.date <= "2026-11-04")).toBe(true);
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(3);
    const balance = new Map<string, number>([["main", 6_500_000], ["belanja", 1_200_000], ["darurat", 42_000_000], ["liburan", 4_500_000], ["gopay", 150_000]]);
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) balance.set(r.account, balance.get(r.account)! + r.amount);
    for (const [, b] of balance) expect(b).toBeGreaterThanOrEqual(0);
    // Mostly categorized, a few left for the reviewer to categorize.
    const uncategorized = rows.filter((r) => !r.category).length;
    expect(uncategorized).toBeGreaterThan(0);
    expect(uncategorized).toBeLessThan(10);
  });

  test("the same day builds the same rows", () => {
    expect(demoRows("2026-11-04")).toEqual(demoRows("2026-11-04"));
    expect(wibDate(new Date("2026-11-04T18:00:00Z"))).toBe("2026-11-05");
  });
});

describe("seeding", () => {
  test("is idempotent and undoes the reviewer's writes", async () => {
    const first = await seedDemo(db, NOW);
    const before = await counts(DEMO_HOUSEHOLD_ID);
    expect(before.accounts).toBe(5);
    expect(before.transactions).toBe(first.transactions);
    expect(before.scenarios).toBe(1);
    expect(before.budgets).toBe(3);

    // A reviewer adds a row, a scenario and renames the household.
    await call(appRouter.transactions.quickAdd, { amountText: "50rb", description: "test" }, { context: ctx(demo) });
    await call(appRouter.household.rename, { name: "Renamed" }, { context: ctx(demo) });
    expect((await counts(DEMO_HOUSEHOLD_ID)).transactions).toBe(before.transactions + 1);

    await seedDemo(db, NOW);
    expect(await counts(DEMO_HOUSEHOLD_ID)).toEqual(before);
    const [h] = await db.select().from(schema.household).where(eq(schema.household.id, DEMO_HOUSEHOLD_ID));
    expect(h!.name).toBe("Keluarga Demo");
    const members = await db.select().from(schema.householdMember).where(eq(schema.householdMember.userId, DEMO_USER_ID));
    expect(members).toEqual([expect.objectContaining({ householdId: DEMO_HOUSEHOLD_ID, role: "owner", isDefault: true })]);
    expect((await db.select({ n: count() }).from(schema.user).where(eq(schema.user.id, DEMO_USER_ID)))[0]!.n).toBe(1);
  });

  test("never touches other households", async () => {
    const dewi = await testPrincipal(db, "Dewi");
    const acc = await testAccount(db, dewi);
    await call(appRouter.transactions.add, { accountId: acc, date: "2026-11-01", amount: -2_500_000, description: "Warung" }, { context: ctx(dewi) });
    const dewiBefore = await counts(dewi.householdId);

    await seedDemo(db, NOW);
    await seedDemo(db, NOW);
    expect(await counts(dewi.householdId)).toEqual(dewiBefore);

    // Each side sees only its own household.
    const mine = await call(appRouter.transactions.search, {}, { context: ctx(dewi) });
    expect(mine.transactions.map((r: { description: string }) => r.description)).toEqual(["Warung"]);
    const theirs = await call(appRouter.accounts.list, {}, { context: ctx(demo) });
    expect(theirs.accounts.map((a: { id: string }) => a.id)).not.toContain(acc);
    expect(theirs.accounts).toHaveLength(5);
  });

  test("a household with a real member is left alone; the demo user only steps out", async () => {
    await seedDemo(db, NOW);
    const dewi = await testPrincipal(db, "Dewi");
    await db.insert(schema.householdMember).values({ householdId: dewi.householdId, userId: DEMO_USER_ID, role: "member", isDefault: false });
    const before = await counts(dewi.householdId);
    await seedDemo(db, NOW);
    expect(await counts(dewi.householdId)).toEqual(before);
    const members = await db.select().from(schema.householdMember).where(eq(schema.householdMember.householdId, dewi.householdId));
    expect(members.map((m) => m.userId)).toEqual([dewi.userId]);
  });

  test("the saved plan and the baseline work on the demo data", async () => {
    await seedDemo(db, NOW);
    const list = await call(appRouter.plan.scenarios.list, undefined, { context: ctx(demo) });
    expect(list.scenarios.map((s: { name: string }) => s.name)).toEqual(["Mobil listrik + bayi"]);
    const base = await call(appRouter.plan.baseline, {}, { context: ctx(demo) });
    expect(base).toBeTruthy();
  });
});

describe("demo login", () => {
  test("off without DEMO_LOGIN_CODE, refused with a wrong code", async () => {
    await expect(demoLogin(db, CODE, undefined, NOW)).rejects.toThrow("not available");
    await expect(demoLogin(db, CODE, "  ", NOW)).rejects.toThrow("not available");
    await expect(demoLogin(db, "guess", CODE, NOW)).rejects.toThrow("not right");
    expect((await db.select({ n: count() }).from(schema.user).where(eq(schema.user.id, DEMO_USER_ID)))[0]!.n).toBe(0);
    expect(await demoCodeMatches(CODE, CODE)).toBe(true);
    expect(await demoCodeMatches(` ${CODE} `, CODE)).toBe(true);
    expect(await demoCodeMatches("", "")).toBe(false);
  });

  test("the right code seeds and signs in as the demo user", async () => {
    expect(await demoLogin(db, CODE, CODE, NOW)).toEqual({ userId: DEMO_USER_ID });
    expect((await counts(DEMO_HOUSEHOLD_ID)).accounts).toBe(5);
  });

  test("the phone app's token endpoint: off, wrong, then a short-lived token for the demo household only", async () => {
    await expect(call(appRouter.demo.token, { code: CODE }, { context: ctx(null, null) })).rejects.toThrow("not available");
    await expect(call(appRouter.demo.token, { code: "nope" }, { context: ctx(null) })).rejects.toThrow("not right");
    const out = await call(appRouter.demo.token, { code: CODE }, { context: ctx(null) });
    expect(out.token.startsWith("brk_")).toBe(true);
    expect(new Date(out.expiresAt!).getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000 + 1000);
    const p = await principalFromToken(db, out.token);
    expect(p).toMatchObject({ userId: DEMO_USER_ID, householdId: DEMO_HOUSEHOLD_ID, via: "token" });
    const me = await call(appRouter.me, undefined, { context: ctx(p) });
    expect(me.demo).toBe(true);
  });

  test("rate limited per IP", async () => {
    const context: Context = { ...ctx(null), request: { ip: "1.2.3.4", adminEmails: [], allow: async (bucket) => bucket !== "demo" } };
    await expect(call(appRouter.demo.token, { code: CODE }, { context })).rejects.toThrow("Too many");
  });

  test("the demo account is always Pro, even with billing on", async () => {
    await seedDemo(db, NOW);
    const billing: BillingConfig = { enforced: true, joyo: { apiUrl: "https://joyorogo.invalid", key: "k" }, proUrl: "https://x.invalid/pro", trialDays: 0, grandfather: null, proEmails: [] };
    const plan = await userPlan(db, DEMO_USER_ID, billing, { now: NOW });
    expect(plan.entitlement.plan).toBe("pro");
    expect(plan.limits.mcpConnector).toBe(true);
  });
});

describe("restricted actions", () => {
  beforeEach(async () => {
    await seedDemo(db, NOW);
  });

  test("the demo account cannot reach real people or outlive the reset", async () => {
    const c = { context: ctx(demo) };
    const refused = [
      () => call(appRouter.household.invites.create, { email: "someone@example.com" }, c),
      () => call(appRouter.household.invites.accept, { token: "x".repeat(32) }, c),
      () => call(appRouter.household.leave, undefined, c),
      () => call(appRouter.household.delete, { confirmName: "Keluarga Demo" }, c),
      () => call(appRouter.account.delete, { confirmEmail: "reviewer@demo.joyoarto.invalid" }, c),
      () => call(appRouter.tokens.create, { name: "forever" }, c),
      () => call(appRouter.tokens.create, { name: "month", expiresInDays: 30 }, c),
      () => call(appRouter.imports.email.regenerate, undefined, c),
    ];
    for (const attempt of refused) await expect(attempt()).rejects.toThrow("demo account");
    // Nothing changed.
    expect((await counts(DEMO_HOUSEHOLD_ID)).accounts).toBe(5);
    expect(await db.select().from(schema.householdInvite)).toHaveLength(0);
    expect(await db.select().from(schema.emailImportAddress)).toHaveLength(0);
  });

  test("a one-day token and ordinary writes are allowed", async () => {
    const c = { context: ctx(demo) };
    const tok = await call(appRouter.tokens.create, { name: "day", expiresInDays: 1 }, c);
    expect(tok.token.startsWith("brk_")).toBe(true);
    const added = await call(appRouter.transactions.quickAdd, { amountText: "25rb", description: "kopi" }, c);
    expect(added.created).toBe(true);
  });

  test("real users are not affected by the demo rules", async () => {
    const dewi = await testPrincipal(db, "Dewi");
    const tok = await call(appRouter.tokens.create, { name: "forever" }, { context: ctx(dewi) });
    expect(tok.expiresAt).toBeNull();
    const me = await call(appRouter.me, undefined, { context: ctx(dewi) });
    expect(me.demo).toBe(false);
  });
});

test("demo data has habits for Where to save", async () => {
  const { db } = await testDb();
  await seedDemo(db);
  const r = await savings(db, { userId: DEMO_USER_ID, householdId: DEMO_HOUSEHOLD_ID, scopes: ["finance:read"], via: "session" }, { effect: false } as never);
  const keys = r.habits.filter((h) => h.suggestion).map((h) => h.key);
  expect(keys).toEqual(expect.arrayContaining(["food/coffee", "food/dining", "minimarket"]));
});

describe("AI connections to the demo", () => {
  test("the daily reset drops consents and refresh tokens approved over a week ago, and keeps newer ones", async () => {
    await seedDemo(db, NOW);
    const day = 86_400_000;
    await db.insert(schema.oauthClient).values({ id: "c", clientId: "claude", redirectUris: "[]" } as never);
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * day);
    await db.insert(schema.oauthConsent).values([
      { id: "old", clientId: "claude", userId: DEMO_USER_ID, scopes: "finance:read", createdAt: at(10) },
      { id: "renewed", clientId: "claude", userId: DEMO_USER_ID, scopes: "finance:read", createdAt: at(10), updatedAt: at(1) },
      { id: "new", clientId: "claude", userId: DEMO_USER_ID, scopes: "finance:read", createdAt: at(2) },
    ]);
    await db.insert(schema.oauthRefreshToken).values([
      { id: "r-old", token: "t1", clientId: "claude", userId: DEMO_USER_ID, scopes: "finance:read", expiresAt: at(-20), createdAt: at(10) },
      { id: "r-new", token: "t2", clientId: "claude", userId: DEMO_USER_ID, scopes: "finance:read", expiresAt: at(-20), createdAt: at(2) },
    ]);
    await pruneDemoConnections(db, NOW);
    expect((await db.select({ id: schema.oauthConsent.id }).from(schema.oauthConsent)).map((r) => r.id).sort()).toEqual(["new", "renewed"]);
    expect((await db.select({ id: schema.oauthRefreshToken.id }).from(schema.oauthRefreshToken)).map((r) => r.id)).toEqual(["r-new"]);
  });
});
