import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Context, Principal } from "../context";
import { carUpgradeTemplate } from "../lib/plan/templates";
import { appRouter } from "../routers/index";
import { testDb, testPrincipal } from "../test/d1";
import { acceptInvite, createInvite } from "./household";

const jt = (x: number) => Math.round(x * 100_000_000);

let db: Database;
let dewi: Principal;
let spouse: Principal;
let other: Principal;

beforeEach(async () => {
  ({ db } = await testDb());
  dewi = await testPrincipal(db, "Dewi");
  other = await testPrincipal(db, "Stranger");
  // Dewi's spouse is a member of her household.
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "Budi", email: `${userId}@example.com` });
  await db.insert(schema.householdMember).values({ householdId: dewi.householdId, userId, role: "member", isDefault: true });
  spouse = { userId, householdId: dewi.householdId, scopes: ["finance:read", "finance:write"], via: "session" };
});

const ctx = (principal: Principal): Context => ({ db, principal });
const r = appRouter.plan.scenarios;
/** No ledger in these tests: every plan brings its own income, spending and balances. */
const own = { monthlyIncome: jt(25), monthlySpending: jt(10), existingInstallments: 0, startingBalances: { emergency: jt(80), goal: jt(120), spending: jt(10) }, startMonth: "2026-12" };
const upgrade = carUpgradeTemplate({ month: "2026-12" }).items;
const carOnly = [{ type: "loan" as const, label: "Car", price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5 }];

describe("saved scenarios", () => {
  test("save, list, get: shared with the household, invisible to others", async () => {
    const saved = await call(r.save, { name: "Aira then EX2", plan: { ...own, items: upgrade }, view: { blocks: [1] } }, { context: ctx(dewi) });
    expect(saved.created).toBe(true);
    expect(saved.scenario).toMatchObject({ name: "Aira then EX2", itemCount: 2, labels: ["Wuling Aira EV LR", "Geely EX2 Max"], valid: true, view: { blocks: [1] } });
    expect(saved.scenario.createdBy).toEqual({ id: dewi.userId, name: "Dewi" });
    // Defaults are applied on save.
    expect(saved.scenario.plan.horizonMonths).toBe(36);
    expect(saved.scenario.plan.items[0]).toMatchObject({ fundedFrom: "goal", sale: { afterMonths: 18, proceedsTo: "goal" } });

    const list = await call(r.list, {}, { context: ctx(spouse) });
    expect(list.scenarios.map((s) => s.name)).toEqual(["Aira then EX2"]);
    expect("view" in list.scenarios[0]!).toBe(false);
    expect((await call(r.get, { id: saved.scenario.id }, { context: ctx(spouse) })).plan.monthlyIncome).toBe(jt(25));

    expect((await call(r.list, {}, { context: ctx(other) })).scenarios).toEqual([]);
    await expect(call(r.get, { id: saved.scenario.id }, { context: ctx(other) })).rejects.toThrow(/not found/);
    await expect(call(r.delete, { id: saved.scenario.id }, { context: ctx(other) })).rejects.toThrow(/not found/);
    await expect(call(r.save, { id: saved.scenario.id, name: "Mine now", plan: { items: [] } }, { context: ctx(other) })).rejects.toThrow(/not found/);
  });

  test("upsert by name or id; the spouse's edit is recorded; names are unique", async () => {
    const a = await call(r.save, { name: "Car", plan: { items: carOnly }, view: { x: 1 } }, { context: ctx(dewi) });
    const again = await call(r.save, { name: "Car", plan: { ...own, items: carOnly } }, { context: ctx(spouse) });
    expect(again.created).toBe(false);
    expect(again.scenario.id).toBe(a.scenario.id);
    expect(again.scenario.updatedBy).toEqual({ id: spouse.userId, name: "Budi" });
    expect(again.scenario.createdBy?.id).toBe(dewi.userId);
    expect(again.scenario.view).toBeNull(); // not sent: cleared, since it may not match the new items

    const renamed = await call(r.save, { id: a.scenario.id, name: "Car (48 mo)", plan: { items: carOnly } }, { context: ctx(dewi) });
    expect(renamed.scenario.name).toBe("Car (48 mo)");
    await call(r.save, { name: "Baby", plan: { items: [] } }, { context: ctx(dewi) });
    await expect(call(r.save, { id: a.scenario.id, name: "Baby", plan: { items: [] } }, { context: ctx(dewi) })).rejects.toThrow(/already called/);
    expect((await call(r.list, {}, { context: ctx(dewi) })).scenarios).toHaveLength(2);
  });

  test("the plan is validated by the planner's schema", async () => {
    await expect(call(r.save, { name: "Bad", plan: { items: [{ type: "loan", price: jt(100), tenorMonths: 12 }] } } as never, { context: ctx(dewi) })).rejects.toThrow();
    await expect(call(r.save, { name: "Bad", plan: { horizonMonths: 1000 } } as never, { context: ctx(dewi) })).rejects.toThrow();
    await expect(call(r.save, { name: " ", plan: {} }, { context: ctx(dewi) })).rejects.toThrow();
  });

  test("delete", async () => {
    const a = await call(r.save, { name: "Car", plan: { items: carOnly } }, { context: ctx(dewi) });
    expect(await call(r.delete, { id: a.scenario.id }, { context: ctx(spouse) })).toEqual({ deleted: true, id: a.scenario.id });
    expect((await call(r.list, {}, { context: ctx(dewi) })).scenarios).toEqual([]);
    await expect(call(r.delete, { id: a.scenario.id }, { context: ctx(dewi) })).rejects.toThrow(/not found/);
  });

  test("simulate a saved scenario by id, with overrides on top", async () => {
    const a = await call(r.save, { name: "Upgrade", plan: { ...own, items: upgrade } }, { context: ctx(dewi) });
    const sim = await call(appRouter.plan.simulate, { scenarioId: a.scenario.id }, { context: ctx(spouse) });
    expect(sim.scenario).toEqual({ id: a.scenario.id, name: "Upgrade" });
    expect(sim.baseline.monthlyIncome.amount).toBe(jt(25));
    expect(sim.horizonMonths).toBe(36);
    expect(sim.loans).toHaveLength(2);
    expect(sim.loans[0]!.sale).toMatchObject({ month: "2028-06", outstanding: { amount: 0 }, net: { amount: jt(108.6) } });

    const lower = await call(appRouter.plan.simulate, { scenarioId: a.scenario.id, monthlyIncome: jt(15), horizonMonths: 12, items: [] }, { context: ctx(dewi) });
    expect(lower.baseline.monthlyIncome.amount).toBe(jt(15));
    expect(lower.baseline.monthlySpending.amount).toBe(jt(10)); // still the saved one
    expect(lower.horizonMonths).toBe(12);
    expect(lower.loans).toHaveLength(0);

    await expect(call(appRouter.plan.simulate, { scenarioId: a.scenario.id }, { context: ctx(other) })).rejects.toThrow(/not found/);
  });

  test("compare saved and inline scenarios against one baseline", async () => {
    const a = await call(r.save, { name: "Upgrade", plan: { ...own, items: upgrade } }, { context: ctx(dewi) });
    const b = await call(r.save, { name: "Car only", plan: { items: carOnly } }, { context: ctx(dewi) });
    const c = await call(
      appRouter.plan.compare,
      { ...own, monthlyIncome: jt(20), scenarios: [{ scenarioId: a.scenario.id }, { scenarioId: b.scenario.id, name: "Renamed" }, { name: "Inline", items: [] }] },
      { context: ctx(spouse) },
    );
    // "Inline" is empty, so no extra "No change" scenario is added.
    expect(c.scenarios.map((s) => s.name)).toEqual(["Upgrade", "Renamed", "Inline"]);
    expect(c.baseline.monthlyIncome.amount).toBe(jt(20));
    expect(c.scenarios[0]!.loans[0]!.sale?.net.amount).toBe(jt(108.6));
    expect(c.notes.join(" ")).toContain('"Upgrade" has its own monthlyIncome');
    expect(c.assumptions.some((x) => x.includes("settles the loan"))).toBe(true);

    await expect(call(appRouter.plan.compare, { scenarios: [{ items: [] }] } as never, { context: ctx(dewi) })).rejects.toThrow();
    await expect(call(appRouter.plan.compare, { scenarios: [{ scenarioId: "nope" }] }, { context: ctx(dewi) })).rejects.toThrow(/not found/);
  });

  test("joining a household brings the scenarios of an empty personal household along", async () => {
    await call(r.save, { name: "Car", plan: { items: carOnly } }, { context: ctx(dewi) });
    await call(r.save, { name: "Car", plan: { items: [] } }, { context: ctx(other) });
    await call(r.save, { name: "Solo", plan: { items: [] } }, { context: ctx(other) });
    const [stranger] = await db.select().from(schema.user).where(eq(schema.user.id, other.userId));
    const invite = await createInvite(db, dewi, { email: stranger!.email, role: "member" });
    const joined = await acceptInvite(db, other, { token: invite.token });
    expect(joined.removedEmptyHousehold).toBe(true);
    const names = (await call(r.list, {}, { context: ctx(dewi) })).scenarios.map((s) => s.name).sort();
    expect(names).toEqual(["Car", "Car (2)", "Solo"]);
  });
});
