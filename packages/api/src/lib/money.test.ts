import { describe, expect, test } from "bun:test";

import { formatMoney, parseAmount } from "./money";

describe("parseAmount", () => {
  test.each([
    ["25,000.00", 2500000],
    ["1,250,000.50", 125000050],
    ["1.250.000,50", 125000050],
    ["12.500", 1250000],
    ["1.250.000", 125000000],
    ["Rp 12.500", 1250000],
    ["Rp12.500,00", 1250000],
    ["12.50", 1250],
    ["-12,500.00", -1250000],
    ["(12,500.00)", -1250000],
    ["25,000.00 DB", -2500000],
    ["25,000.00 CR", 2500000],
    ["25000", 2500000],
    ["0", 0],
  ])("%s", (raw, minor) => {
    expect(parseAmount(raw, "IDR")).toBe(minor);
  });

  test("explicit decimal style wins over the guess", () => {
    expect(parseAmount("12,500", "IDR", "dot")).toBe(1250000);
    expect(parseAmount("12.500", "IDR", "comma")).toBe(1250000);
    expect(parseAmount("12,5", "IDR", "comma")).toBe(1250);
  });

  test("rejects non-numbers", () => {
    expect(() => parseAmount("abc")).toThrow();
    expect(() => parseAmount("")).toThrow();
  });
});

describe("formatMoney", () => {
  test("rupiah without decimals", () => expect(formatMoney(1250000, "IDR")).toBe("Rp 12.500"));
  test("negative with decimals", () => expect(formatMoney(-125000050, "IDR")).toBe("-Rp 1.250.000,50"));
  test("zero", () => expect(formatMoney(0, "IDR")).toBe("Rp 0"));
});
