import { expect, test } from "bun:test";

import { activeFilterCount, categorizeCall, datePresets, EMPTY_FILTERS, filtersFromParams, filtersToParams, groupByDay, isFiltered, presetOf, ruleSavedText, searchInput } from "./transaction-filters";

test("route params round trip, malformed values dropped", () => {
  const f = filtersFromParams({ q: "kopi", uncategorized: "true", from: "2026-11-01", to: "nope", status: "weird", accountId: ["a1"] });
  expect(f).toEqual({ ...EMPTY_FILTERS, q: "kopi", uncategorized: true, from: "2026-11-01", accountId: "a1" });
  expect(filtersToParams(f)).toEqual({ q: "kopi", uncategorized: "true", from: "2026-11-01", accountId: "a1" });
  expect(activeFilterCount(f)).toBe(3);
  expect(isFiltered(EMPTY_FILTERS)).toBe(false);
  expect(isFiltered({ ...EMPTY_FILTERS, q: " x " })).toBe(true);
});

test("search input: uncategorized wins over a category", () => {
  expect(searchInput({ ...EMPTY_FILTERS, category: "food", uncategorized: true, status: "pending", q: "  a " }, 20)).toEqual({ limit: 20, q: "a", uncategorized: true, status: "pending" });
  expect(searchInput(EMPTY_FILTERS)).toEqual({ limit: 50 });
});

test("date presets in WIB", () => {
  const now = new Date("2026-11-04T03:00:00Z");
  const p = datePresets(now);
  expect(p.map((x) => [x.key, x.from, x.to])).toEqual([
    ["this-month", "2026-11-01", "2026-11-04"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["30d", "2026-10-06", "2026-11-04"],
    ["90d", "2026-08-07", "2026-11-04"],
  ]);
  expect(presetOf({ from: "2026-10-01", to: "2026-10-31" }, now)).toBe("last-month");
  expect(presetOf({ from: "2026-10-02", to: "2026-10-31" }, now)).toBeNull();
});

test("day sections", () => {
  const s = groupByDay([{ date: "2026-11-04" }, { date: "2026-11-04" }, { date: "2026-11-03" }, { date: "2026-10-01" }], "2026-11-04");
  expect(s.map((x) => [x.title, x.data.length])).toEqual([
    ["Today", 2],
    ["Yesterday", 1],
    ["Thu 1 Oct", 1],
  ]);
});

test("categorize with and without a rule", () => {
  expect(categorizeCall({ id: "t", merchant: "Kopi" }, null, true)).toEqual({ kind: "clear", input: { id: "t", category: null } });
  expect(categorizeCall({ id: "t", merchant: " Kopi " }, "food", true)).toEqual({
    kind: "categorize",
    input: { ids: ["t"], category: "food", createRule: { field: "merchant", match: "equals", pattern: "Kopi", applyToExisting: true } },
  });
  expect(categorizeCall({ id: "t", merchant: null }, "food", true)).toEqual({ kind: "categorize", input: { ids: ["t"], category: "food" } });
  expect(categorizeCall({ id: "t", merchant: "Kopi" }, "food", false).input).toEqual({ ids: ["t"], category: "food" });
  expect(ruleSavedText({ rule: { when: "merchant = Kopi" }, category: "food", ruleAppliedToExisting: 3 })).toBe("merchant = Kopi → food (also applied to 3 more)");
  expect(ruleSavedText({ rule: null, category: "food", ruleAppliedToExisting: 0 })).toBeNull();
});

test("reimburse filter from route params to the search input", () => {
  const f = filtersFromParams({ reimburse: "open" });
  expect(f.reimburse).toBe("open");
  expect(searchInput(f, 10)).toEqual({ limit: 10, reimburse: "open" });
  expect(activeFilterCount(f)).toBe(1);
  expect(filtersFromParams({ reimburse: "bogus" }).reimburse).toBe("");
});
