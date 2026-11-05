import { describe, expect, test } from "bun:test";

import { amountInWords, buildSnapshot, claimCsv, claimNumber, claimTotals, longDate, nextClaimSequence, terbilang } from "./reimburse";

describe("terbilang", () => {
  test.each([
    [0, "nol"],
    [1, "satu"],
    [10, "sepuluh"],
    [11, "sebelas"],
    [12, "dua belas"],
    [19, "sembilan belas"],
    [20, "dua puluh"],
    [25, "dua puluh lima"],
    [100, "seratus"],
    [101, "seratus satu"],
    [111, "seratus sebelas"],
    [250, "dua ratus lima puluh"],
    [1000, "seribu"],
    [1001, "seribu satu"],
    [1500, "seribu lima ratus"],
    [2000, "dua ribu"],
    [11000, "sebelas ribu"],
    [25250, "dua puluh lima ribu dua ratus lima puluh"],
    [100000, "seratus ribu"],
    [1000000, "satu juta"],
    [1500000, "satu juta lima ratus ribu"],
    [16_000_000, "enam belas juta"],
    [1_000_000_000, "satu miliar"],
    [2_345_678_901, "dua miliar tiga ratus empat puluh lima juta enam ratus tujuh puluh delapan ribu sembilan ratus satu"],
    [1_000_000_000_000, "satu triliun"],
  ])("%d", (n, words) => expect(terbilang(n)).toBe(words));

  test("negative", () => expect(terbilang(-5000)).toBe("minus lima ribu"));
});

test("amount in words, from minor units", () => {
  expect(amountInWords(2_550_000, "IDR")).toBe("Dua puluh lima ribu lima ratus rupiah");
  expect(amountInWords(125_000_050, "IDR")).toBe("Satu juta dua ratus lima puluh ribu rupiah lima puluh sen");
  expect(amountInWords(0, "IDR")).toBe("Nol rupiah");
});

test("claim totals: per category, largest first; refunds reduce", () => {
  const r = claimTotals([
    { amount: 5_000_000, category: "Transport" },
    { amount: 12_000_000, category: "Makan" },
    { amount: 3_000_000, category: "Transport" },
    { amount: 1_000_000, category: null },
    { amount: -500_000, category: "Makan" },
  ]);
  expect(r.total).toBe(20_500_000);
  expect(r.subtotals).toEqual([
    { category: "Makan", amount: 11_500_000, count: 2 },
    { category: "Transport", amount: 8_000_000, count: 2 },
    { category: "Tanpa kategori", amount: 1_000_000, count: 1 },
  ]);
  expect(r.subtotals.reduce((s, x) => s + x.amount, 0)).toBe(r.total);
});

test("claim numbers per year", () => {
  expect(claimNumber(2026, 7)).toBe("RB-2026-0007");
  expect(nextClaimSequence([], 2026)).toBe(1);
  expect(nextClaimSequence(["RB-2026-0001", "RB-2026-0003", "RB-2025-0009", "junk"], 2026)).toBe(4);
});

const header = {
  number: "RB-2026-0001",
  issuedOn: "2026-11-05",
  currency: "IDR",
  company: "PT Maju Jaya",
  claimant: { name: "Dewi", employeeId: "E-12", department: "Sales" },
  approver: { name: "Budi", email: "budi@maju.example" },
  notes: "Kunjungan klien Bandung",
};
const item = (id: string, date: string, amount: number, category: string | null, photos = 1) => ({
  transactionId: id,
  date,
  merchant: `M ${id}`,
  description: `D ${id}`,
  category,
  paidWith: "GoPay",
  amount,
  note: null,
  attachmentIds: Array.from({ length: photos }, (_, i) => `${id}-${i}`),
});

test("snapshot: date order, numbered, period from the items, total in words", () => {
  const s = buildSnapshot(header, [item("b", "2026-11-03", 5_000_000, "Transport"), item("a", "2026-11-01", 2_500_000, "Makan", 0)]);
  expect(s.items.map((i) => [i.no, i.transactionId])).toEqual([
    [1, "a"],
    [2, "b"],
  ]);
  expect([s.periodFrom, s.periodTo]).toEqual(["2026-11-01", "2026-11-03"]);
  expect(s.total).toBe(7_500_000);
  expect(s.totalInWords).toBe("Tujuh puluh lima ribu rupiah");
  expect(() => buildSnapshot(header, [])).toThrow();
});

test("csv: header, rows, totals; formula cells are defused", () => {
  const s = buildSnapshot(header, [item("a", "2026-11-01", 2_500_000, "Makan"), { ...item("b", "2026-11-02", 1_000_000, null, 0), merchant: "=HYPERLINK(\"x\")" }]);
  const csv = claimCsv(s);
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain("RB-2026-0001");
  expect(csv).toContain("1,2026-11-01,M a,D a,Makan,GoPay,25000.00,1 foto,");
  expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  expect(csv).toContain("tanpa bukti");
  expect(csv).toContain("Total,,35000.00,,Tiga puluh lima ribu rupiah");
});

test("long dates in Indonesian", () => expect(longDate("2026-11-05")).toBe("5 November 2026"));
