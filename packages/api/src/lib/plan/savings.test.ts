import { describe, expect, test } from "bun:test";

import { formatMoney } from "../money";
import { DEFAULT_HABIT_SLUGS, cutEffect, cutItems, detectHabits, minimarketBrand, suggest, trendOf } from "./savings";
import type { HabitRow, HabitsInput } from "./savings";
import { DEFAULT_RULES, simulate } from "./simulate";
import type { SimBaseline } from "./simulate";

const rp = (rupiah: number) => rupiah * 100;
const MONTHS = ["2026-07", "2026-08", "2026-09"];
const CATS = new Map([
  ["food/coffee", "Kopi"],
  ["food/dining", "Eating out"],
  ["food/delivery", "Food delivery"],
  ["food/groceries", "Groceries"],
  ["transport/ride-hailing", "Ride-hailing"],
  ["shopping/online", "Online shopping"],
]);

let seq = 0;
const row = (date: string, rupiah: number, slug: string | null, merchant: string | null = null, description = "QRIS"): HabitRow => ({
  id: `r${++seq}`,
  date,
  amount: rp(rupiah),
  merchant,
  description,
  slug,
});

/** `perWeek` purchases a week of `rupiah` each, every week of each month (days 1, 8, 15, 22 and spread inside). */
function weekly(months: string[], perWeek: number, rupiah: number, slug: string | null, merchant: string | null) {
  const out: HabitRow[] = [];
  for (const m of months) {
    for (let w = 0; w < 4; w++) {
      for (let k = 0; k < perWeek; k++) out.push(row(`${m}-${String(1 + w * 7 + k).padStart(2, "0")}`, rupiah, slug, merchant));
    }
  }
  return out;
}

const input = (rows: HabitRow[], over: Partial<HabitsInput> = {}): HabitsInput => ({ months: MONTHS, rows, categories: CATS, monthlyIncome: rp(15_000_000), ...over });

describe("detectHabits", () => {
  test("coffee three times a week: stats, a 3x -> 2x suggestion and its saving", () => {
    const r = detectHabits(input(weekly(MONTHS, 3, 30_000, "food/coffee", "Kopi Kenangan")));
    const h = r.habits.find((x) => x.key === "food/coffee")!;
    expect(h.name).toBe("Kopi");
    expect(h.count).toBe(36);
    expect(h.perMonth).toBe(12);
    expect(h.averageTicket).toBe(rp(30_000));
    expect(h.monthly).toBe(rp(360_000));
    expect(h.incomeSharePct).toBe(2.4);
    expect(h.topMerchants[0]).toEqual({ name: "Kopi Kenangan", amount: rp(1_080_000), count: 36 });
    // 92 days = 13.14 weeks: 2.7 a week, so "3x -> 2x".
    expect(h.suggestion!.unit).toBe("week");
    expect(h.suggestion!.current).toBe(2.7);
    expect(h.suggestion!.target).toBe(2);
    // Saving = (12 a month - 2 x 4.38 weeks) x Rp 30.000.
    const weeksPerMonth = 92 / 7 / 3;
    expect(h.suggestion!.saving).toBe(Math.round(((12 - 2 * weeksPerMonth) * rp(30_000)) / 100) * 100);
    expect(h.suggestion!.options.map((o) => o.target)).toEqual([2, 1, 0]);
    expect(r.totalSaving).toBe(h.suggestion!.saving);
  });

  test("a chosen target replaces the suggestion; an impossible one is ignored", () => {
    const rows = weekly(MONTHS, 3, 30_000, "food/coffee", null);
    const one = detectHabits(input(rows, { targets: { "food/coffee": 1 } })).habits[0]!;
    const two = detectHabits(input(rows)).habits[0]!;
    expect(one.suggestion!.target).toBe(1);
    expect(one.suggestion!.saving).toBeGreaterThan(two.suggestion!.saving);
    expect(detectHabits(input(rows, { targets: { "food/coffee": 9 } })).habits[0]!.suggestion!.target).toBe(2);
    const kept = detectHabits(input(rows, { targets: { "food/coffee": null } }));
    expect(kept.habits[0]!.included).toBe(false);
    expect(kept.habits[0]!.suggestion!.target).toBe(2);
    expect(kept.totalSaving).toBe(0);
    expect(cutItems(kept.habits, (x) => formatMoney(x))).toEqual([]);
  });

  test("renamed and missing categories: names come from the household, missing slugs are reported", () => {
    const cats = new Map([["food/coffee", "Ngopi"], ["food/coffee/kenangan", "Kopi Kenangan"]]);
    const rows = [...weekly(MONTHS, 2, 25_000, "food/coffee/kenangan", null), ...weekly(MONTHS, 1, 40_000, "food/dining", null)];
    const r = detectHabits(input(rows, { categories: cats }));
    expect(r.habits.map((h) => h.key)).toEqual(["food/coffee"]);
    expect(r.habits[0]!.name).toBe("Ngopi");
    expect(r.habits[0]!.slugs).toEqual(["food/coffee/kenangan"]);
    expect(r.missing).toEqual(DEFAULT_HABIT_SLUGS.filter((s) => s !== "food/coffee"));
  });

  test("a child counts under the most specific habit slug asked for", () => {
    const cats = new Map([["food", "Food"], ["food/coffee", "Coffee"]]);
    const rows = weekly(MONTHS, 2, 25_000, "food/coffee", null);
    const r = detectHabits(input(rows, { categories: cats, habitSlugs: ["food", "food/coffee"] }));
    expect(r.habits.map((h) => h.key)).toEqual(["food/coffee"]);
  });

  test("too little data: one month, or under four purchases a month, gives numbers but no suggestion", () => {
    const one = detectHabits(input(weekly(["2026-09"], 3, 30_000, "food/coffee", null), { months: ["2026-09"] })).habits[0]!;
    expect(one.suggestion).toBeNull();
    expect(one.reason).toContain("1 complete month");
    const rare = detectHabits(input(MONTHS.flatMap((m) => [row(`${m}-03`, 80_000, "food/dining"), row(`${m}-17`, 90_000, "food/dining")]))).habits[0]!;
    expect(rare.perMonth).toBe(2);
    expect(rare.suggestion).toBeNull();
    expect(rare.reason).toContain("suggestions start at 4");
    expect(detectHabits(input([])).habits).toEqual([]);
  });

  test("minimarket: small baskets at the chains in any category, large ones and food/snacks rows not double counted", () => {
    const cats = new Map([...CATS, ["food/snacks", "Jajan"]]);
    const rows = [
      ...weekly(MONTHS, 2, 25_000, "food/groceries", "Indomaret"),
      ...weekly(MONTHS, 1, 18_000, null, null).map((r) => ({ ...r, description: "QRIS ALFAMART CABANG 12" })),
      ...MONTHS.map((m) => row(`${m}-28`, 450_000, "food/groceries", "Indomaret")),
      ...weekly(MONTHS, 1, 15_000, "food/snacks", "Alfamidi"),
    ];
    const r = detectHabits(input(rows, { categories: cats }));
    const mini = r.habits.find((h) => h.key === "minimarket")!;
    expect(mini.kind).toBe("minimarket");
    expect(mini.count).toBe(36);
    expect(mini.averageTicket).toBe(rp(22_667));
    expect(mini.topMerchants.map((x) => x.name)).toEqual(["Indomaret", "Alfamart"]);
    const snacks = r.habits.find((h) => h.key === "food/snacks")!;
    expect(snacks.count).toBe(12);
    expect(mini.count + snacks.count).toBe(48);
    // A higher threshold takes in the large shop too.
    expect(detectHabits(input(rows, { categories: cats, minimarketMax: rp(500_000) })).habits.find((h) => h.key === "minimarket")!.count).toBe(39);
  });

  test("baseline one-offs and rows outside the months are left out; refunds (no outflow) never reach a habit", () => {
    const rows = weekly(MONTHS, 2, 50_000, "food/dining", null);
    const big = row("2026-08-20", 3_000_000, "food/dining");
    const before = row("2026-06-20", 50_000, "food/dining");
    const refund = { ...row("2026-08-21", 50_000, "food/dining"), amount: -rp(50_000) };
    const h = detectHabits(input([...rows, big, before, refund], { excludedIds: new Set([big.id]) })).habits[0]!;
    expect(h.count).toBe(24);
    expect(h.monthly).toBe(rp(400_000));
  });

  test("online shopping gets a monthly cap, tidied to Rp 50.000", () => {
    const rows = MONTHS.flatMap((m) => [5, 10, 15, 20, 25].map((d) => row(`${m}-${d}`, 160_000, "shopping/online", "Shopee")));
    const h = detectHabits(input(rows)).habits[0]!;
    expect(h.monthly).toBe(rp(800_000));
    expect(h.suggestion!.unit).toBe("cap");
    expect(h.suggestion!.options.map((o) => o.target)).toEqual([rp(600_000), rp(400_000), rp(200_000)]);
    expect(h.suggestion!.target).toBe(rp(600_000));
    expect(h.suggestion!.saving).toBe(rp(200_000));
  });

  test("habits are ranked by possible saving", () => {
    const rows = [...weekly(MONTHS, 3, 20_000, "food/coffee", null), ...weekly(MONTHS, 3, 60_000, "transport/ride-hailing", "Gojek")];
    expect(detectHabits(input(rows)).habits.map((h) => h.key)).toEqual(["transport/ride-hailing", "food/coffee"]);
  });

  test("no income: no share of income", () => {
    expect(detectHabits(input(weekly(MONTHS, 2, 20_000, "food/coffee", null), { monthlyIncome: 0 })).habits[0]!.incomeSharePct).toBeNull();
  });
});

describe("helpers", () => {
  test("minimarket brands", () => {
    expect(minimarketBrand("QRIS INDOMARET PLUS")).toBe("Indomaret");
    expect(minimarketBrand("Alfa Midi Kemang")).toBe("Alfamidi");
    expect(minimarketBrand("FAMILY MART")).toBe("FamilyMart");
    expect(minimarketBrand("CIRCLE K")).toBe("Circle K");
    expect(minimarketBrand("Superindo")).toBeNull();
  });

  test("trend: last month vs the earlier ones; last three with six months", () => {
    expect(trendOf([{ month: "a", amount: 100 }, { month: "b", amount: 100 }, { month: "c", amount: 200 }]).direction).toBe("up");
    expect(trendOf([{ month: "a", amount: 100 }, { month: "b", amount: 90 }]).direction).toBe("flat");
    expect(trendOf([{ month: "a", amount: 0 }, { month: "b", amount: 90 }]).direction).toBe("new");
    const six = trendOf([100, 100, 100, 50, 50, 50].map((amount, i) => ({ month: String(i), amount: amount * 100 })));
    expect(six.direction).toBe("down");
    expect(six.pct).toBe(-50);
  });

  test("suggest: monthly frequency below 1.5 a week, a third less from four on", () => {
    const s = suggest({ key: "food/dining", monthly: rp(500_000), perMonth: 5, perWeek: 5 / 4.35, averageTicket: rp(100_000) }, 4.35)!;
    expect(s.unit).toBe("month");
    expect(s.target).toBe(3);
    expect(s.saving).toBe(rp(200_000));
    const many = suggest({ key: "food/coffee", monthly: rp(1_300_000), perMonth: 26, perWeek: 6, averageTicket: rp(50_000) }, 4.35)!;
    expect(many.target).toBe(4);
    expect(many.options[0]!.target).toBe(5);
  });
});

describe("cut effect", () => {
  const base: SimBaseline = {
    currency: "IDR",
    monthlyIncome: rp(15_000_000),
    monthlySpending: rp(12_000_000),
    existingInstallments: 0,
    balances: { emergency: rp(20_000_000), goal: rp(10_000_000), spending: rp(2_000_000) },
    accountRoles: {},
  };
  const opts = { startMonth: "2026-11", horizonMonths: 60, rules: DEFAULT_RULES };

  test("cut items lower the outflow in the simulator", () => {
    const r = simulate(base, [{ type: "cut", label: "Kopi", monthly: rp(500_000) }], opts);
    expect(r.projection[0]!.spending).toBe(rp(11_500_000));
    expect(r.projection[0]!.cuts).toBe(rp(500_000));
    expect(r.projection[0]!.freeCash).toBe(rp(3_500_000));
    expect(r.assumptions.some((a) => a.includes("Spending cuts"))).toBe(true);
    // Never more than the spending itself.
    expect(simulate(base, [{ type: "cut", label: "x", monthly: rp(99_000_000) }], opts).projection[0]!.spending).toBe(0);
  });

  test("the emergency fund reaches 6 months sooner, and a goal amount too", () => {
    const cuts = [{ type: "cut" as const, label: "Kopi", monthly: rp(1_000_000) }];
    const e = cutEffect(base, [], cuts, opts, rp(60_000_000));
    const ef = e.milestones.find((m) => m.id === "emergency")!;
    // Without: (72 - 20) jt at 3 jt a month = 18 months (index 17). With: (66 - 20) at 4 jt = 11.5 -> index 11.
    expect(ef.without).toBe("2028-04");
    expect(ef.with).toBe("2027-10");
    expect(ef.monthsSooner).toBe(6);
    const goal = e.milestones.find((m) => m.id === "goalAmount")!;
    expect(goal.monthsSooner).toBeGreaterThan(0);
    expect(e.endBalance.with - e.endBalance.without).toBe(rp(60_000_000));
  });

  test("a failing car plan that passes with the cuts, and goal savings rebuilt sooner", () => {
    const car = { type: "loan" as const, label: "Car", price: rp(300_000_000), downPaymentPct: 30, tenorMonths: 60, ratePct: 4, fundedFrom: "goal", asset: "car" as const, rateType: "flat" as const, payment: "arrears" as const, insuranceFinanced: false, insuranceRenewalPct: 0, adminFee: 0, provisionPct: 0, feesFinanced: false, fuelMonthly: 0, parkingTollMonthly: 0, maintenanceMonthly: 0, savesMonthly: 0 };
    const tight = { ...base, monthlySpending: rp(11_000_000), balances: { emergency: rp(60_000_000), goal: rp(90_000_000), spending: rp(2_000_000) } };
    const without = simulate(tight, [car], opts);
    expect(without.rules.find((r) => r.id === "cashflow")!.status).toBe("fail");
    const e = cutEffect(tight, [car], [{ type: "cut", label: "Cuts", monthly: rp(1_500_000) }], opts);
    expect(e.rulesImproved.map((r) => r.id)).toContain("cashflow");
    expect(e.milestones.some((m) => m.id === "goalRebuilt")).toBe(true);
  });

  test("cut items from habits: id per habit, label in words, skipped when there is no saving", () => {
    const r = detectHabits(input(weekly(MONTHS, 3, 30_000, "food/coffee", null)));
    const items = cutItems(r.habits, (x) => formatMoney(x), "2026-11");
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("cut:food/coffee");
    expect(items[0]!.label).toBe("Kopi: 2.7x -> 2x a week");
    expect(items[0]!.startMonth).toBe("2026-11");
    // Cut items already in the plan are not counted twice.
    const e = cutEffect(base, items, items, opts);
    expect(e.monthlySaving).toBe(items[0]!.monthly);
  });
});
