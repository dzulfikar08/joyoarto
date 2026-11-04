import { describe, expect, test } from "bun:test";

import { findAmount, parseCaptureRules, wordsToNumber } from "./capture-parse";

const accounts = [
  { id: "gopay", name: "GoPay wallet", institution: "GoPay", type: "ewallet" },
  { id: "jago", name: "Jago Main Pocket", institution: "Bank Jago", type: "bank" },
  { id: "cash", name: "Dompet", institution: null, type: "cash" },
];
const categories = [
  { slug: "food/coffee", name: "Coffee & snacks", kind: "expense" },
  { slug: "food/dining", name: "Eating out", kind: "expense" },
  { slug: "income/salary", name: "Salary", kind: "income" },
  { slug: "transport/parking-toll", name: "Parking", kind: "expense" },
];
const ctx = { today: "2026-11-04", accounts, categories };

describe("wordsToNumber", () => {
  test.each([
    ["dua puluh lima ribu", 25_000],
    ["seratus lima puluh ribu", 150_000],
    ["dua ratus lima puluh ribu", 250_000],
    ["lima belas ribu", 15_000],
    ["16 juta", 16_000_000],
    ["satu setengah juta", 1_500_000],
    ["setengah juta", 500_000],
    ["seribu", 1_000],
    ["tiga juta dua ratus ribu", 3_200_000],
  ])("%s", (words, n) => expect(wordsToNumber(words)).toBe(n));
  test("not a number", () => expect(wordsToNumber("kopi")).toBeNull());
});

describe("findAmount", () => {
  test("shorthand beats a bare count", () => expect(findAmount("2 gelas kopi 50rb")?.amount).toBe(5_000_000));
  test("Rp with dots", () => expect(findAmount("bayar Rp 125.000 tadi")?.amount).toBe(12_500_000));
});

describe("parseCaptureRules", () => {
  test("spoken coffee with GoPay", () => {
    const d = parseCaptureRules("beli kopi kenangan dua puluh lima ribu pakai gopay", ctx);
    expect(d).toMatchObject({ amount: 2_500_000, direction: "out", accountId: "gopay", category: "food/coffee", date: "2026-11-04", description: "Kopi Kenangan" });
  });
  test("salary in", () => {
    const d = parseCaptureRules("gaji masuk 16 juta", ctx);
    expect(d).toMatchObject({ amount: 1_600_000_000, direction: "in", category: "income/salary", description: "Gaji" });
  });
  test("typed shorthand", () => {
    expect(parseCaptureRules("kopi 25rb gopay", ctx)).toMatchObject({ amount: 2_500_000, accountId: "gopay", description: "Kopi" });
  });
  test("yesterday, cash", () => {
    expect(parseCaptureRules("kemarin parkir 5 ribu cash", ctx)).toMatchObject({ amount: 500_000, accountId: "cash", date: "2026-11-03", category: "transport/parking-toll" });
  });
  test("no amount", () => expect(parseCaptureRules("makan siang", ctx).amount).toBeNull());
});
