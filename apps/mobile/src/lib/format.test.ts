import { describe, expect, test } from "bun:test";

import { addDays, amountInputText, compactMoney, currentMonthWib, dayLabel, daySectionTitle, formatMoney, isDay, monthEnd, monthLabel, niceTicks, pctText, shiftMonth, todayWib } from "./format";

describe("money", () => {
  test("formatMoney matches the API's display notation", () => {
    expect(formatMoney(2500000)).toBe("Rp 25.000");
    expect(formatMoney(-125000050)).toBe("-Rp 1.250.000,50");
    expect(formatMoney(0)).toBe("Rp 0");
    expect(formatMoney(1234, "USD")).toBe("USD 12,34");
    expect(formatMoney(1500, "JPY")).toBe("JPY 1.500");
  });
  test("compactMoney uses Indonesian shorthand", () => {
    expect(compactMoney(25_000_00)).toBe("25 rb");
    expect(compactMoney(250_000_000)).toBe("2,5 jt");
    expect(compactMoney(-120_000_000_000)).toBe("-1,2 M");
    expect(compactMoney(50_000)).toBe("500");
  });
  test("amountInputText is what a person would type", () => {
    expect(amountInputText(2500000)).toBe("25.000");
    expect(amountInputText(-150050)).toBe("1.500,50");
    expect(amountInputText(null)).toBe("");
  });
  test("niceTicks", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(95, 4)).toEqual([0, 25, 50, 75, 100]);
  });
  test("pctText", () => {
    expect(pctText(12)).toBe("+12%");
    expect(pctText(-3.46)).toBe("-3,5%");
    expect(pctText(2000)).toBe("+>999%");
    expect(pctText(0)).toBe("0%");
  });
});

describe("dates", () => {
  test("months", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("2026-01", "short")).toBe("Jan");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
  test("WIB turns the month over at 17:00 UTC", () => {
    expect(currentMonthWib(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10");
    expect(currentMonthWib(new Date("2026-10-31T17:00:00Z"))).toBe("2026-11");
    expect(todayWib(new Date("2026-11-03T18:00:00Z"))).toBe("2026-11-04");
  });
  test("day labels", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayLabel("2026-11-03", "2026-11-04")).toBe("Tue 3 Nov");
    expect(dayLabel("2025-11-03", "2026-11-04")).toBe("Mon 3 Nov 2025");
    expect(daySectionTitle("2026-11-04", "2026-11-04")).toBe("Today");
    expect(daySectionTitle("2026-11-03", "2026-11-04")).toBe("Yesterday");
    expect(isDay("2026-11-04")).toBe(true);
    expect(isDay("2026-11-4")).toBe(false);
  });
});
