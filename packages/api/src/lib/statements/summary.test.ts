import { expect, test } from "bun:test";

import { sampleGopayText, sampleJagoText } from "./sample";
import { summarizeStatements } from "./summary";

test("the demo sample passes every check and merges GoPay merchants", () => {
  const s = summarizeStatements([
    { name: "jago.pdf", text: sampleJagoText() },
    { name: "gopay.pdf", text: sampleGopayText() },
  ]);
  expect(s.problems).toEqual([]);
  expect(s.verified).toBe(true);
  expect(s.files.map((f) => f.kind)).toEqual(["jago", "gopay"]);
  expect(s.holder).toBe("RINA PRATAMA");
  expect(s.pockets.map((p) => p.name)).toEqual(["Main Pocket", "Tabungan Si Kecil", "Dana Darurat"]);
  expect(s.gopay).toEqual({ merged: 6, unnamed: 0, walletPayments: 3 });
  expect(s.merchants.find((m) => m.key === "Kopi Kenangan")).toMatchObject({ amount: 2800000, count: 1 });
  // Moves between pockets, own top-ups and cash are not spending.
  expect(s.categories.some((c) => c.key.startsWith("transfer"))).toBe(false);
  expect(s.totals.transfersOut).toBe(30000000 + 50000000);
  const spent = s.categories.reduce((n, c) => n + c.amount, 0);
  expect(spent).toBe(s.totals.moneyOut + 18000 * 100 + 100000 * 100 + 46000 * 100);
});

test("without the GoPay e-statement the payments stay unnamed; a broken balance is reported", () => {
  const s = summarizeStatements([{ name: "jago.pdf", text: sampleJagoText() }]);
  expect(s.gopay.unnamed).toBe(6);
  expect(s.merchants.find((m) => m.key === "GoPay")?.count).toBe(6);
  const broken = summarizeStatements([{ name: "jago.pdf", text: sampleJagoText().replace("-28.000,00", "-29.000,00") }]);
  expect(broken.verified).toBe(false);
  expect(broken.problems.length).toBeGreaterThan(0);
  expect(summarizeStatements([{ name: "x.pdf", text: "hello" }]).verified).toBe(false);
});
