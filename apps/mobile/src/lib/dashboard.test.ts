import { expect, test } from "bun:test";

import { arcPath, attentionItems, changeText, delta, donutAngles, donutSlices, monthRange, OTHER, periodLabel } from "./dashboard";

const cat = (slug: string | null, amount: number, share: number) => ({
  slug,
  name: slug ?? "Uncategorized",
  amount,
  display: `Rp ${amount / 100}`,
  share,
  previous: { amount: amount / 2, display: "" },
  previousFullMonth: { amount },
  changePct: 100,
});

test("six slices, the rest folded into Other", () => {
  const cats = Array.from({ length: 8 }, (_, i) => cat(i === 7 ? null : `c${i}`, (8 - i) * 1000, 12.5));
  const { slices, rest, other } = donutSlices({ categories: cats as never, currency: "IDR" });
  expect(slices).toHaveLength(7);
  expect(slices[6]!.key).toBe(OTHER);
  expect(slices[6]!.colorIndex).toBeNull();
  expect(rest.map((c) => c.slug)).toEqual(["c6", null]);
  expect(other).toMatchObject({ amount: 3000, share: 25, changePct: 100 });
  expect(donutSlices({ categories: cats.slice(0, 2) as never, currency: "IDR" }).other).toBeNull();
});

test("change and delta texts", () => {
  expect(changeText({ changePct: null, previousFullMonth: { amount: 0 } })).toBe("new");
  expect(changeText({ changePct: null, previousFullMonth: { amount: 5 } })).toBe("–");
  expect(changeText({ changePct: 150.4, previousFullMonth: { amount: 5 } })).toBe("+150%");
  expect(delta(12, true)).toEqual({ text: "▲ +12%", good: true });
  expect(delta(12, false)?.good).toBe(false);
  expect(delta(0.2, true)).toEqual({ text: "→ same", good: null });
  expect(delta(-3, true, "pts")).toEqual({ text: "▼ -3 pts", good: false });
  expect(delta(null, true)).toBeNull();
});

test("comparison period", () => {
  expect(periodLabel({ previousMonth: "2026-10", comparedTo: { from: "2026-10-01", to: "2026-10-31" } })).toBe("Oct");
  expect(periodLabel({ previousMonth: "2026-10", comparedTo: { from: "2026-10-01", to: "2026-10-04" } })).toBe("Oct 1–4");
});

test("attention items link to filtered transactions", () => {
  const items = attentionItems({
    month: "2026-11",
    today: "2026-11-20",
    spendingByDay: Array.from({ length: 30 }) as never,
    attention: {
      uncategorizedThisMonth: 2,
      uncategorizedAll: 5,
      pending: 1,
      pendingStale: 1,
      pendingStaleDays: 45,
      staleAccounts: [
        { id: "a", name: "Jago", lastDate: "2026-09-01", daysSince: 80 },
        { id: "b", name: "GoPay", lastDate: null, daysSince: null },
      ],
    } as never,
  });
  expect(items.map((i) => i.key)).toEqual(["unc", "unc-all", "pending", "stale", "a", "b"]);
  expect(items[0]!.link).toEqual({ uncategorized: true, from: "2026-11-01", to: "2026-11-30" });
  expect(items[3]!.link).toEqual({ status: "pending", to: "2026-10-05" });
  const withReimburse = attentionItems({
    month: "2026-11",
    today: "2026-11-20",
    spendingByDay: [] as never,
    attention: { uncategorizedThisMonth: 0, uncategorizedAll: 0, pending: 0, pendingStale: 0, pendingStaleDays: 45, staleAccounts: [], reimburse: { draft: 2, submitted: 1, owed: { amount: 46_000_000, display: "Rp 460.000" } } } as never,
  });
  expect(withReimburse).toEqual([{ key: "reimburse", text: "Rp 460.000 to be reimbursed (diganti kantor): 2 not claimed yet, 1 waiting for the company", link: "reimburse" }]);
  expect(items[5]!.link).toBe("import");
  expect(monthRange({ month: "2026-02", spendingByDay: Array.from({ length: 28 }) as never })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
});

test("donut geometry", () => {
  const angles = donutAngles([1, 1], 0);
  expect(angles[0]).toEqual({ a0: 0, a1: Math.PI });
  expect(donutAngles([0, 0])).toEqual([{ a0: 0, a1: 0 }, { a0: 0, a1: 0 }]);
  // A single full slice stays a drawable arc.
  expect(arcPath(50, 50, 50, 30, 0, Math.PI * 2)).toContain("A 50 50 0 1 1");
  expect(arcPath(50, 50, 50, 30, 0, Math.PI / 2)).toBe("M 50 0 A 50 50 0 0 1 100 50 L 80 50 A 30 30 0 0 0 50 20 Z");
});
