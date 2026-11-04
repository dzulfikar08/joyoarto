import { describe, expect, test } from "bun:test";

import { counterpartyInText, directionInText, findAmountInText, parseAmountText } from "./amount-text";

describe("parseAmountText", () => {
  const cases: [string, number, -1 | 1 | null][] = [
    ["25rb", 2500000, null],
    ["25 rb", 2500000, null],
    ["25ribu", 2500000, null],
    ["25k", 2500000, null],
    ["25K", 2500000, null],
    ["Rp 25.000", 2500000, null],
    ["Rp25.000", 2500000, null],
    ["rp. 25.000,-", 2500000, null],
    ["Rp 25.000,00", 2500000, null],
    ["IDR 1,250,000.00", 125000000, null],
    ["25000", 2500000, null],
    ["1,5jt", 150000000, null],
    ["1.5jt", 150000000, null],
    ["1,5 juta", 150000000, null],
    ["2jt", 200000000, null],
    ["1.250rb", 125000000, null],
    ["1,2M", 120000000000, null],
    ["Rp 12.500,50", 1250050, null],
    ["-25rb", 2500000, -1],
    ["+500k", 50000000, 1],
    ["Rp -25.000", 2500000, -1],
    ["25.000 DB", 2500000, -1],
    ["25.000 CR", 2500000, 1],
    ["  Rp   7.500  ", 750000, null],
  ];
  for (const [text, amount, sign] of cases) {
    test(text, () => expect(parseAmountText(text)).toEqual({ amount, sign }));
  }
  test("rejects what is not an amount", () => {
    for (const bad of ["", "abc", "25xyz", "rb", "Rp", "0", "1.2.34rb"]) expect(() => parseAmountText(bad)).toThrow();
  });
  test("follows the currency's exponent", () => {
    expect(parseAmountText("1.500", "JPY").amount).toBe(1500);
  });
});

describe("notification text", () => {
  const gopay = "Pembayaran berhasil! Kamu bayar Rp25.000 di Kopi Kenangan pakai GoPay.";
  const jago = "Uang masuk Rp 1.500.000 dari BUDI SANTOSO ke Kantong Utama";
  test("finds the amount", () => {
    expect(findAmountInText(gopay)).toEqual({ amount: 2500000, sign: null });
    expect(findAmountInText(jago)?.amount).toBe(150000000);
    expect(findAmountInText("Transfer 50rb ke Andi")?.amount).toBe(5000000);
    expect(findAmountInText("No amount here, order 12345")).toBeNull();
  });
  test("reads the direction", () => {
    expect(directionInText(gopay)).toBe(-1);
    expect(directionInText(jago)).toBe(1);
    expect(directionInText("Halo")).toBeNull();
  });
  test("reads the counterparty", () => {
    expect(counterpartyInText(gopay)).toBe("Kopi Kenangan");
    expect(counterpartyInText(jago)).toBe("BUDI SANTOSO");
    expect(counterpartyInText("Paid Rp 45.000 at Starbucks Grand Indonesia on 3 Nov")).toBe("Starbucks Grand Indonesia");
  });
});
