// CSV import's column mapping, ported from the web (apps/web/src/lib/csv-form.ts): a form of column indexes, filled
// from a preset (BCA, generic) or a saved mapping (which name their columns), turned back into an index-based
// CsvMapping for imports.csv. Plus the phone's pickers (columns, header row, "start from"). Pure, unit-tested.

import { DATE_FORMATS, MAPPING_PRESETS, SUMMARY_ROWS, adjacentMarker, findHeaderRow } from "@baroka/api/lib/csv";
import type { CsvMapping } from "@baroka/api/lib/csv";

import type { PickerOption } from "./options";

export { DATE_FORMATS, MAPPING_PRESETS };
export type { CsvMapping };

export type DateFormat = (typeof DATE_FORMATS)[number];

export type CsvForm = {
  headerRow: number;
  date: number;
  dateFormat: DateFormat;
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

export type SavedMapping = { id: string; name: string; mapping: unknown };

/** CSV, TSV or TXT by name: what the picker accepts (Android often reports CSVs as octet-stream). */
export function isCsvName(name: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(name.trim());
}

/** A fresh form for a file: the header row guessed, columns in the most common order. */
export function initialForm(table: string[][], preset?: CsvMapping, now = new Date()): CsvForm {
  const headerRow = presetHeaderRow(table, preset);
  const base: CsvForm = {
    headerRow,
    date: 0,
    dateFormat: "DD/MM/YYYY",
    year: String(now.getFullYear()),
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
export function formFromPreset(table: string[][], headerRow: number, m: CsvMapping): Partial<CsvForm> {
  const raw = table[headerRow] ?? [];
  const header = raw.map((h) => h.trim().toLowerCase());
  const at = (c: string | number | undefined) => (c === undefined ? -1 : typeof c === "number" ? c : header.indexOf(c.toLowerCase()));
  const out: Partial<CsvForm> = { dateFormat: m.dateFormat, invert: m.invert, decimal: m.decimal ?? "" };
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

export function toMapping(f: CsvForm): CsvMapping {
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

/** The preset for an account's institution (only BCA has one today). */
export function presetFor(institution: string | undefined): CsvMapping | undefined {
  return institution ? MAPPING_PRESETS[institution]?.mapping : undefined;
}

/** Column picker items: "1. Tanggal". */
export function columnOptions(header: readonly string[]): PickerOption[] {
  return header.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h.trim() || "(empty)"}` }));
}

/** Header row picker items from the first rows of the file. */
export function headerRowOptions(table: readonly string[][], max = 30): PickerOption[] {
  return table.slice(0, max).map((r, i) => ({ value: String(i), label: `Row ${i + 1}: ${r.filter(Boolean).slice(0, 3).join(" | ").slice(0, 40) || "(empty)"}` }));
}

/** "Start from" items: saved mappings first, then the presets. Values are `saved:<id>` / `preset:<key>`. */
export function startOptions(saved: readonly SavedMapping[]): PickerOption[] {
  return [
    ...saved.map((s) => ({ value: `saved:${s.id}`, label: `Saved: ${s.name}` })),
    ...Object.entries(MAPPING_PRESETS).map(([k, v]) => ({ value: `preset:${k}`, label: v.label })),
  ];
}

/** Applies a "start from" choice to the form; unchanged when the choice is unknown. */
export function applyStart(table: string[][], form: CsvForm, value: string, saved: readonly SavedMapping[]): CsvForm {
  const [kind, key] = value.split(":");
  const m = kind === "preset" ? MAPPING_PRESETS[key ?? ""]?.mapping : (saved.find((s) => s.id === key)?.mapping as CsvMapping | undefined);
  if (!m) return form;
  const headerRow = presetHeaderRow(table, m, form.headerRow);
  return { ...form, headerRow, ...formFromPreset(table, headerRow, m) };
}

/** Adds or removes a description column, keeping file order. */
export function toggleDescription(form: CsvForm, col: number): CsvForm {
  const has = form.description.includes(col);
  return { ...form, description: has ? form.description.filter((x) => x !== col) : [...form.description, col].sort((a, b) => a - b) };
}

/** Why Preview cannot run yet, or null. */
export function formProblem(form: CsvForm): string | null {
  if (!form.description.length) return "Pick at least one description column.";
  if (form.dateFormat === "DD/MM" && !/^\d{4}$/.test(form.year.trim())) return "Enter the statement's year (4 digits).";
  return null;
}
