/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { MAPPING_PRESETS, applyMapping, parseCsv } from "@baroka/api/lib/csv";

import { initialForm, presetHeaderRow, toMapping } from "./csv-form";

// A KlikBCA "mutasi rekening" export: the account details include the period's dates, which used to be taken for the
// first transaction, so the header was guessed one row too high and the amount fell back to column 3 (Cabang).
const BCA_MUTASI = [
  "No. rekening : ,'1234567890",
  "Nama : ,DEV USER",
  "Periode : ,01/11/2026 - 03/11/2026",
  "Kode Mata Uang : ,Rp",
  ",",
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
  "'01/11,TRSF E-BANKING CR 0111/FTSCY/WS95031 ACME GAJI,0998,15000000.00,CR,16000000.00",
  "'02/11,KARTU DEBIT INDOMARET SUDIRMAN,0123,25000.00,DB,15975000.00",
  "PEND,QRIS KOPI KENANGAN,0000,18000.00,DB,",
  "Saldo Awal,:,1000000.00",
  "Mutasi Kredit,:,15000000.00,1",
  "Mutasi Debet,:,25000.00,1",
  "Saldo Akhir,:,15975000.00",
].join("\n");

describe("BCA preset on a mutasi CSV", () => {
  const table = parseCsv(BCA_MUTASI);
  const bca = MAPPING_PRESETS.bca!.mapping;

  test("maps Jumlah as the amount, the unnamed column after it as DB/CR, and Saldo as the balance", () => {
    const form = initialForm(table, bca);
    const header = table[form.headerRow]!;
    expect(header[form.date]).toBe("Tanggal Transaksi");
    expect(form.description.map((i) => header[i])).toEqual(["Keterangan"]);
    expect(form.mode).toBe("single");
    expect(header[form.amount]).toBe("Jumlah");
    expect(form.marker).toBe(form.amount + 1);
    expect(header[form.balance!]).toBe("Saldo");
  });

  test("the form's mapping imports signed amounts and skips pending and total rows", () => {
    const form = { ...initialForm(table, bca), year: "2026" };
    const { rows, errors } = applyMapping(table, toMapping(form));
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount, r.balanceAfter])).toEqual([
      ["2026-11-01", 1500000000, 1600000000],
      ["2026-11-02", -2500000, 1597500000],
    ]);
  });

  test("without a preset the header is still the row above the first transaction", () => {
    expect(presetHeaderRow(table)).toBe(initialForm(table, bca).headerRow);
  });
});
