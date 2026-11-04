import { describe, expect, test } from "bun:test";

import { MAPPING_PRESETS, applyMapping, findHeaderRow, parseCsv, parseDate } from "./csv";

/** A KlikBCA "mutasi rekening" CSV: account details (with the period's dates), the table, then the totals. parseCsv drops the blank line, so the header is row 4. */
const BCA_MUTASI = [
  "No. rekening : ,'1234567890",
  "Nama : ,DEV USER",
  "Periode : ,01/11/2026 - 03/11/2026",
  "Kode Mata Uang : ,Rp",
  ",",
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
  "'01/11,TRSF E-BANKING CR 0111/FTSCY/WS95031 ACME GAJI,0998,15000000.00,CR,16000000.00",
  "'02/11,KARTU DEBIT INDOMARET SUDIRMAN,0123,25000.00,DB,15975000.00",
  "'03/11,BIAYA ADM,0000,15000.00,DB,15960000.00",
  "PEND,QRIS KOPI KENANGAN,0000,18000.00,DB,",
  "Saldo Awal,:,1000000.00",
  "Mutasi Kredit,:,15000000.00,1",
  "Mutasi Debet,:,40000.00,2",
  "Saldo Akhir,:,15960000.00",
].join("\n");

describe("parseCsv", () => {
  test("quotes, doubled quotes, CRLF and a guessed delimiter", () => {
    expect(parseCsv('a;b\r\n"x;1";"say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x;1", 'say "hi"'],
    ]);
  });
});

describe("parseDate", () => {
  test("formats", () => {
    expect(parseDate("03/11/2026", "DD/MM/YYYY")).toBe("2026-11-03");
    expect(parseDate("'03/11", "DD/MM", 2026)).toBe("2026-11-03");
    expect(parseDate("3 Agu 2026", "DD MMM YYYY")).toBe("2026-08-03");
    expect(parseDate("03 Des 2026", "DD MMM YYYY")).toBe("2026-12-03");
    expect(parseDate("2026-11-03", "YYYY-MM-DD")).toBe("2026-11-03");
  });
  test("rejects impossible dates", () => {
    expect(() => parseDate("31/02/2026", "DD/MM/YYYY")).toThrow();
  });
});

describe("findHeaderRow", () => {
  const table = parseCsv(BCA_MUTASI);
  test("by the named date column", () => {
    expect(findHeaderRow(table, "Tanggal Transaksi")).toBe(4);
  });
  test("guessed: the period line above BCA's table is not a transaction", () => {
    expect(findHeaderRow(table)).toBe(4);
    expect(findHeaderRow(table, "Tanggal")).toBe(4);
  });
});

describe("applyMapping", () => {
  test("BCA-style export: header below account details, DB/CR markers, pending rows skipped", () => {
    const csv = [
      "No. rekening : ,1234567890",
      "Nama : ,DZULFIKAR",
      "",
      "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
      "'01/11,TRSF E-BANKING CR 0111/ACME GAJI,0000,\"15,000,000.00\",CR,\"16,000,000.00\"",
      "'02/11,KARTU DEBIT INDOMARET,0000,\"25,000.00 DB\",,\"15,975,000.00\"",
      "PEND,QRIS KOPI,0000,\"18,000.00 DB\",,",
    ].join("\n");
    const mapping = { ...MAPPING_PRESETS.bca!.mapping, year: 2026 };
    const { rows, errors } = applyMapping(parseCsv(csv), mapping);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: "2026-11-01", amount: 1500000000, description: "TRSF E-BANKING CR 0111/ACME GAJI", balanceAfter: 1600000000 },
      { date: "2026-11-02", amount: -2500000, description: "KARTU DEBIT INDOMARET", balanceAfter: 1597500000 },
    ]);
  });

  test("BCA mutasi CSV: amount from Jumlah (not Cabang), sign from the unnamed CR/DB column, totals skipped", () => {
    const { rows, errors } = applyMapping(parseCsv(BCA_MUTASI), { ...MAPPING_PRESETS.bca!.mapping, year: 2026 });
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: "2026-11-01", amount: 1500000000, description: "TRSF E-BANKING CR 0111/FTSCY/WS95031 ACME GAJI", balanceAfter: 1600000000 },
      { date: "2026-11-02", amount: -2500000, description: "KARTU DEBIT INDOMARET SUDIRMAN", balanceAfter: 1597500000 },
      { date: "2026-11-03", amount: -1500000, description: "BIAYA ADM", balanceAfter: 1596000000 },
    ]);
  });

  test("a separate DB/CR column decides the sign", () => {
    const table = [
      ["Tanggal", "Uraian", "Nominal", "D/K"],
      ["01/11/2026", "Gaji", "15.000.000,00", "K"],
      ["02/11/2026", "Belanja", "25.000,00", "D"],
    ];
    const { rows } = applyMapping(table, {
      skipRows: 0, hasHeader: true, date: "Tanggal", dateFormat: "DD/MM/YYYY", description: ["Uraian"],
      amount: "Nominal", marker: "D/K", decimal: "comma", invert: false, skipDateValues: [],
    });
    expect(rows.map((r) => r.amount)).toEqual([1500000000, -2500000]);
  });

  test("debit/credit columns", () => {
    const table = [
      ["Date", "Description", "Debit", "Credit", "Balance"],
      ["01/11/2026", "Salary", "0.00", "10,000,000.00", "10,000,000.00"],
      ["02/11/2026", "Rent", "3,000,000.00", "0.00", "7,000,000.00"],
    ];
    const { rows, errors } = applyMapping(table, MAPPING_PRESETS.generic_debit_credit!.mapping);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.amount)).toEqual([1000000000, -300000000]);
    expect(rows[1]!.balanceAfter).toBe(700000000);
  });
});
