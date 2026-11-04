/// <reference types="bun" />
import { expect, test } from "bun:test";

import { compactMoney, currentMonthWib, monthLabel, niceTicks, shiftMonth } from "./format";

test("compactMoney uses Indonesian shorthand", () => {
  expect(compactMoney(0)).toBe("0");
  expect(compactMoney(25_000_00)).toBe("25 rb");
  expect(compactMoney(2_500_000_00)).toBe("2,5 jt");
  expect(compactMoney(-1_200_000_000_00)).toBe("-1,2 M");
});

test("niceTicks covers the max with round steps", () => {
  expect(niceTicks(9_300_000_00)).toEqual([0, 2_500_000_00, 5_000_000_00, 7_500_000_00, 10_000_000_00]);
  expect(niceTicks(0)).toEqual([0]);
  const t = niceTicks(123);
  expect(t[t.length - 1]!).toBeGreaterThanOrEqual(123);
});

test("month helpers", () => {
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(monthLabel("2026-11")).toBe("November 2026");
  expect(monthLabel("2026-11", "short")).toBe("Nov");
  expect(currentMonthWib(new Date("2026-10-31T17:30:00Z"))).toBe("2026-11");
});
