import { expect, test } from "bun:test";

import { day, isCalendarDay, month } from "./common";

test("day accepts only real calendar days", () => {
  expect(day.safeParse("2026-02-28").success).toBe(true);
  expect(day.safeParse("2028-02-29").success).toBe(true);
  expect(day.safeParse("2026-02-29").success).toBe(false);
  expect(day.safeParse("2026-02-31").success).toBe(false);
  expect(day.safeParse("2026-13-01").success).toBe(false);
  expect(day.safeParse("2026-11-00").success).toBe(false);
  expect(day.safeParse("2026-1-01").success).toBe(false);
  expect(isCalendarDay("2026-12-31")).toBe(true);
});

test("month accepts 01..12 only", () => {
  expect(month.safeParse("2026-12").success).toBe(true);
  expect(month.safeParse("2026-00").success).toBe(false);
  expect(month.safeParse("2026-13").success).toBe(false);
});
