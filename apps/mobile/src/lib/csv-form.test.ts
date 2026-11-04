import { parseCsv } from "@baroka/api/lib/csv";
import { expect, test } from "bun:test";

import { applyStart, columnOptions, formProblem, headerRowOptions, initialForm, isCsvName, presetFor, startOptions, toMapping, toggleDescription } from "./csv-form";

// KlikBCA-like layout (made-up rows): a title line, the header, rows with an unnamed CR/DB column after Jumlah.
const BCA = parseCsv(
  [
    "Informasi Rekening - Mutasi Rekening",
    "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
    "01/10,TRSF E-BANKING DB KOPI,0000,25000.00,DB,975000.00",
    "02/10,GAJI,0000,1000000.00,CR,1975000.00",
  ].join("\n"),
);

test("BCA preset finds the named columns and the adjacent DB/CR marker", () => {
  const f = initialForm(BCA, presetFor("bca"), new Date("2026-11-04T00:00:00Z"));
  expect(f.headerRow).toBe(1);
  expect(f.date).toBe(0);
  expect(f.dateFormat).toBe("DD/MM");
  expect(f.description).toEqual([1]);
  expect(f.mode).toBe("single");
  expect(f.amount).toBe(3);
  expect(f.marker).toBe(4);
  expect(f.balance).toBe(5);
  expect(f.decimal).toBe("dot");
  expect(f.year).toBe("2026");
});

test("toMapping is index-based and carries the year only for DD/MM", () => {
  const f = initialForm(BCA, presetFor("bca"), new Date("2026-11-04T00:00:00Z"));
  const m = toMapping(f);
  expect(m.skipRows).toBe(1);
  expect(m.year).toBe(2026);
  expect(m.amount).toBe(3);
  expect(m.marker).toBe(4);
  expect(m.debit).toBeUndefined();
  expect(m.skipDateValues).toContain("PEND");
  const split = toMapping({ ...f, mode: "split", dateFormat: "DD/MM/YYYY", marker: null, balance: null, decimal: "" });
  expect(split.debit).toBe(2);
  expect(split.credit).toBe(3);
  expect(split.amount).toBeUndefined();
  expect(split.year).toBeUndefined();
  expect(split.balance).toBeUndefined();
  expect(split.decimal).toBeUndefined();
});

test("start from a preset or a saved mapping", () => {
  const table = parseCsv("Date,Desc,Debit,Credit,Balance\n2026-10-01,Kopi,25000,,975000");
  const f = initialForm(table);
  expect(f.mode).toBe("single");
  const g = applyStart(table, f, "preset:generic_debit_credit", []);
  expect(g.mode).toBe("split");
  expect([g.debit, g.credit, g.balance]).toEqual([2, 3, 4]);
  const saved = [{ id: "m1", name: "Mine", mapping: { skipRows: 0, hasHeader: true, date: 0, dateFormat: "YYYY-MM-DD", description: [1], amount: 2, invert: true, skipDateValues: [] } }];
  const h = applyStart(table, f, "saved:m1", saved);
  expect(h.dateFormat).toBe("YYYY-MM-DD");
  expect(h.invert).toBe(true);
  expect(applyStart(table, f, "saved:nope", saved)).toBe(f);
  expect(startOptions(saved)[0]).toEqual({ value: "saved:m1", label: "Saved: Mine" });
  expect(startOptions([]).some((o) => o.value === "preset:bca")).toBe(true);
});

test("pickers, description toggle and checks", () => {
  expect(columnOptions(["Tanggal", ""])).toEqual([
    { value: "0", label: "1. Tanggal" },
    { value: "1", label: "2. (empty)" },
  ]);
  expect(headerRowOptions([["a", "", "b", "c", "d"]])[0]!.label).toBe("Row 1: a | b | c");
  const f = initialForm(parseCsv("a,b,c\n1,2,3"));
  expect(toggleDescription(toggleDescription(f, 0), 1).description).toEqual([0]);
  expect(toggleDescription(f, 0).description).toEqual([0, 1]);
  expect(formProblem({ ...f, description: [] })).toMatch(/description/);
  expect(formProblem({ ...f, dateFormat: "DD/MM", year: "26" })).toMatch(/year/);
  expect(formProblem(f)).toBeNull();
  expect(isCsvName("mutasi.CSV")).toBe(true);
  expect(isCsvName("statement.pdf")).toBe(false);
});
