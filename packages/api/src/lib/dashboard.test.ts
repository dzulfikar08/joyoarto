import { describe, expect, test } from "bun:test";

import {
  addDays,
  categoryComparison,
  cumulativeByDay,
  daysBetween,
  groupAccounts,
  monthBounds,
  pctChange,
  SAVINGS_RATE_MIN_INCOME_IDR,
  savingsRate,
  staleAccounts,
  todayWib,
} from "./dashboard";

test("monthBounds handles leap years and month lengths", () => {
  expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29", days: 29 });
  expect(monthBounds("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30", days: 30 });
  expect(monthBounds("2026-12").to).toBe("2026-12-31");
});

test("todayWib turns over at 17:00 UTC", () => {
  expect(todayWib(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10-31");
  expect(todayWib(new Date("2026-10-31T17:00:00Z"))).toBe("2026-11-01");
});

test("addDays and daysBetween", () => {
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(daysBetween("2026-09-30", "2026-11-04")).toBe(35);
});

test("pctChange", () => {
  expect(pctChange(150, 100)).toBe(50);
  expect(pctChange(50, 100)).toBe(-50);
  expect(pctChange(100, 0)).toBeNull();
  expect(pctChange(-50, -100)).toBe(50);
});

describe("cumulativeByDay", () => {
  const daily = [
    { date: "2026-10-01", amount: 100 },
    { date: "2026-10-31", amount: 50 },
    { date: "2026-11-01", amount: 10 },
    { date: "2026-11-03", amount: 20 },
    { date: "2026-11-03", amount: 5 },
  ];

  test("current month stops at today", () => {
    const s = cumulativeByDay("2026-11", "2026-10", daily, "2026-11-04");
    expect(s.length).toBe(30);
    expect(s[0]).toEqual({ day: 1, current: 10, previous: 100 });
    expect(s[3]).toEqual({ day: 4, current: 35, previous: 100 });
    expect(s[4]!.current).toBeNull();
    // October's 31st folds into the last point, so the line ends at its full total.
    expect(s[29]!.previous).toBe(150);
  });

  test("past month runs to its last day; a future month has no current line", () => {
    expect(cumulativeByDay("2026-11", "2026-10", daily, "2026-12-15")[29]!.current).toBe(35);
    expect(cumulativeByDay("2026-12", "2026-11", daily, "2026-11-04").every((d) => d.current === null)).toBe(true);
  });
});

test("groupAccounts orders types and sums only the base currency", () => {
  const acc = (type: string, amount: number, currency = "IDR") => ({ type, currency, balance: { amount } });
  const g = groupAccounts([acc("credit_card", -500), acc("bank", 1000), acc("ewallet", 200), acc("bank", 300), acc("bank", 99, "USD")], "IDR");
  expect(g.groups.map((x) => [x.type, x.total])).toEqual([
    ["bank", 1300],
    ["ewallet", 200],
    ["credit_card", -500],
  ]);
  expect(g.total).toBe(1000);
});

test("staleAccounts: 35+ days or never used, oldest first", () => {
  const s = staleAccounts(
    [
      { id: "a", lastDate: "2026-11-01" },
      { id: "b", lastDate: "2026-09-30" },
      { id: "c", lastDate: null },
      { id: "d", lastDate: "2026-08-01" },
      { id: "e", lastDate: "2026-10-01" },
    ],
    "2026-11-04",
  );
  expect(s.map((x) => x.id)).toEqual(["c", "d", "b"]);
});

describe("savingsRate", () => {
  const minIncome = SAVINGS_RATE_MIN_INCOME_IDR;
  test("normal month", () => {
    expect(
      savingsRate(10_000_000_00, 7_500_000_00, { minIncome, referenceIncome: 9_000_000_00 }),
    ).toEqual({ value: 25, note: null });
  });
  test("tiny income early in the month is too early, not -576.8%", () => {
    // Rp 150.000 of income against Rp 1.015.200 of spending.
    expect(savingsRate(15_000_000, 101_520_000, { minIncome })).toEqual({
      value: null,
      note: "too-early",
    });
  });
  test("income under 10% of the same window last month is too early", () => {
    expect(
      savingsRate(80_000_000, 10_000_000, { minIncome, referenceIncome: 1_000_000_000 }),
    ).toEqual({ value: null, note: "too-early" });
    expect(
      savingsRate(100_000_000, 10_000_000, { minIncome, referenceIncome: 1_000_000_000 }),
    ).toEqual({ value: 90, note: null });
  });
  test("no income or a rate below -100% is not shown", () => {
    expect(savingsRate(0, 100, {})).toEqual({ value: null, note: "too-early" });
    expect(savingsRate(100_000_000, 250_000_000, { minIncome })).toEqual({
      value: null,
      note: "out-of-range",
    });
    expect(savingsRate(100_000_000, 200_000_000, { minIncome })).toEqual({
      value: -100,
      note: null,
    });
  });
  test("no floor without minIncome", () => {
    expect(savingsRate(1000, 500)).toEqual({ value: 50, note: null });
  });
});

describe("categoryComparison", () => {
  // November 4: compare Nov 1–4 with Oct 1–4; October spent most of its food money later in the month.
  const rows = [
    { slug: "food", month: "2026-11", total: -400, window: 0, count: 3 },
    { slug: "food", month: "2026-10", total: -4000, window: -500, count: 30 },
    { slug: "transport", month: "2026-11", total: -100, window: 0, count: 1 },
    { slug: "transport", month: "2026-10", total: -900, window: 0, count: 5 },
    { slug: null, month: "2026-11", total: -500, window: 0, count: 2 },
    { slug: "home", month: "2026-10", total: -300, window: -300, count: 1 },
    { slug: "refunds", month: "2026-11", total: 50, window: 0, count: 1 },
  ];
  const out = categoryComparison(rows, "2026-11");

  test("compares with the same window, keeps the whole month too", () => {
    const food = out.find((c) => c.slug === "food")!;
    expect(food).toMatchObject({
      current: 400,
      count: 3,
      previous: 500,
      changePct: -20,
      previousFullMonth: 4000,
      changePctFullMonth: -90,
    });
  });
  test("nothing in the window means no comparison, even with spending later last month", () => {
    expect(out.find((c) => c.slug === "transport")).toMatchObject({
      previous: 0,
      changePct: null,
      previousFullMonth: 900,
    });
  });
  test("only categories with spending this month, largest first, with shares", () => {
    expect(out.map((c) => c.slug)).toEqual([null, "food", "transport"]);
    expect(out.map((c) => c.share)).toEqual([50, 40, 10]);
  });
  test("past months: window equals the whole month", () => {
    const past = categoryComparison(
      [
        { slug: "food", month: "2026-10", total: -300, window: 0, count: 1 },
        { slug: "food", month: "2026-09", total: -600, window: -600, count: 2 },
      ],
      "2026-10",
    );
    expect(past[0]).toMatchObject({
      previous: 600,
      changePct: -50,
      previousFullMonth: 600,
      changePctFullMonth: -50,
    });
  });
});
