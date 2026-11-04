import { expect, test } from "bun:test";

import { isGenericMerchant, matchPending, textSimilarity } from "./reconcile";

const p = (id: string, date: string, amount: number, merchant: string | null, capturedAt = 0) => ({ id, date, amount, description: merchant ?? "", merchant, capturedAt });
const s = (index: number, date: string, amount: number, description: string, merchant: string | null = null) => ({ index, date, amount, description, merchant });

test("exact amount within a day matches", () => {
  const m = matchPending([s(0, "2026-11-03", -2500000, "QRIS KOPI KENANGAN")], [p("a", "2026-11-02", -2500000, "Kopi")]);
  expect(m.get(0)?.id).toBe("a");
});

test("a different amount, two days apart or the other sign does not match", () => {
  const rows = [s(0, "2026-11-03", -2500000, "KOPI")];
  expect(matchPending(rows, [p("a", "2026-11-03", -2500100, "Kopi")]).size).toBe(0);
  expect(matchPending(rows, [p("a", "2026-11-01", -2500000, "Kopi")]).size).toBe(0);
  expect(matchPending(rows, [p("a", "2026-11-05", -2500000, "Kopi")]).size).toBe(0);
  expect(matchPending(rows, [p("a", "2026-11-03", 2500000, "Kopi")]).size).toBe(0);
  // Month boundary: Oct 31 and Nov 1 are a day apart.
  expect(matchPending([s(0, "2026-11-01", -100, "X")], [p("a", "2026-10-31", -100, "X")]).size).toBe(1);
});

test("several candidates: closest text wins, then closest date, then earliest capture", () => {
  const rows = [s(0, "2026-11-03", -5000000, "QRIS INDOMARET KEMANG", "Indomaret")];
  expect(matchPending(rows, [p("a", "2026-11-03", -5000000, "Parkir"), p("b", "2026-11-02", -5000000, "Indomaret")]).get(0)?.id).toBe("b");
  expect(matchPending(rows, [p("a", "2026-11-02", -5000000, "Bensin"), p("b", "2026-11-03", -5000000, "Parkir")]).get(0)?.id).toBe("b");
  expect(matchPending(rows, [p("a", "2026-11-03", -5000000, "x", 2000), p("b", "2026-11-03", -5000000, "x", 1000)]).get(0)?.id).toBe("b");
});

test("one pending row is claimed once; two identical coffees pair up", () => {
  const rows = [s(0, "2026-11-03", -2500000, "KOPI"), s(1, "2026-11-03", -2500000, "KOPI")];
  const one = matchPending(rows, [p("a", "2026-11-03", -2500000, "Kopi")]);
  expect(one.size).toBe(1);
  const two = matchPending(rows, [p("a", "2026-11-03", -2500000, "Kopi"), p("b", "2026-11-03", -2500000, "Kopi")]);
  expect(new Set([...two.values()].map((x) => x.id))).toEqual(new Set(["a", "b"]));
});

test("text similarity and generic merchants", () => {
  expect(textSimilarity({ description: "QRIS KOPI KENANGAN SENOPATI", merchant: null }, { description: "kopi kenangan", merchant: null })).toBe(1);
  expect(textSimilarity({ description: "Indomaret", merchant: null }, { description: "parkir", merchant: null })).toBe(0);
  expect(isGenericMerchant("GoPay")).toBe(true);
  expect(isGenericMerchant(null)).toBe(true);
  expect(isGenericMerchant("Kopi Kenangan")).toBe(false);
});
