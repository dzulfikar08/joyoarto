// The CSV import screen's column mapping: a form of column indexes, filled from a preset or saved mapping (which name
// their columns) and turned back into an index-based CsvMapping for the API.

import { SUMMARY_ROWS, adjacentMarker, findHeaderRow } from "@baroka/api/lib/csv";
import type { CsvMapping, DATE_FORMATS } from "@baroka/api/lib/csv";

export type Form = {
  headerRow: number;
  date: number;
  dateFormat: (typeof DATE_FORMATS)[number];
  year: string;
  description: number[];
  mode: "single" | "split";
  amount: number;
  marker: number | null;
  debit: number;
  credit: number;
  balance: number | null;
  invert: boolean;
  decimal: "" | "dot" | "comma";
};

/** A fresh form for a file: the header row guessed, columns in the most common order. */
export function initialForm(table: string[][], preset?: CsvMapping): Form {
  const headerRow = presetHeaderRow(table, preset);
  const base: Form = {
    headerRow,
    date: 0,
    dateFormat: "DD/MM/YYYY",
    year: String(new Date().getFullYear()),
    description: [1],
    mode: "single",
    amount: 2,
    marker: null,
    debit: 2,
    credit: 3,
    balance: null,
    invert: false,
    decimal: "",
  };
  return { ...base, ...(preset ? formFromPreset(table, headerRow, preset) : {}) };
}

/** The header row for a mapping: its saved row, else the row naming its date column, else a guess. */
export function presetHeaderRow(table: string[][], m?: CsvMapping, fallback?: number): number {
  if (m?.skipRows) return m.skipRows;
  if (m && typeof m.date === "string") return findHeaderRow(table, m.date);
  return fallback ?? findHeaderRow(table);
}

/** A preset names its columns; find them in the chosen header row. */
export function formFromPreset(table: string[][], headerRow: number, m: CsvMapping): Partial<Form> {
  const raw = table[headerRow] ?? [];
  const header = raw.map((h) => h.trim().toLowerCase());
  const at = (c: string | number | undefined) => (c === undefined ? -1 : typeof c === "number" ? c : header.indexOf(c.toLowerCase()));
  const out: Partial<Form> = { dateFormat: m.dateFormat, invert: m.invert, decimal: m.decimal ?? "" };
  if (at(m.date) >= 0) out.date = at(m.date);
  const desc = m.description.map(at).filter((i) => i >= 0);
  if (desc.length) out.description = desc;
  if (m.amount !== undefined && at(m.amount) >= 0) {
    const amount = at(m.amount);
    const marker = m.marker !== undefined && at(m.marker) >= 0 ? at(m.marker) : adjacentMarker(raw, amount);
    Object.assign(out, { mode: "single", amount, marker: marker ?? null });
  }
  if (m.debit !== undefined && m.credit !== undefined && at(m.debit) >= 0 && at(m.credit) >= 0) Object.assign(out, { mode: "split", debit: at(m.debit), credit: at(m.credit) });
  if (m.balance !== undefined) out.balance = at(m.balance) >= 0 ? at(m.balance) : null;
  return out;
}

export function toMapping(f: Form): CsvMapping {
  return {
    skipRows: f.headerRow,
    hasHeader: true,
    date: f.date,
    dateFormat: f.dateFormat,
    ...(f.dateFormat === "DD/MM" && f.year ? { year: Number(f.year) } : {}),
    description: f.description,
    ...(f.mode === "single" ? { amount: f.amount, ...(f.marker !== null ? { marker: f.marker } : {}) } : { debit: f.debit, credit: f.credit }),
    ...(f.balance !== null ? { balance: f.balance } : {}),
    invert: f.invert,
    ...(f.decimal ? { decimal: f.decimal } : {}),
    skipDateValues: ["PEND", ...SUMMARY_ROWS],
  };
}
