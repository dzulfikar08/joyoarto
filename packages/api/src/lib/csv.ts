import { z } from "zod";

import { parseAmount } from "./money";

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF. The delimiter is guessed from the first lines when omitted. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? guessDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function guessDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
}

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD/MM", "DD MMM YYYY", "DD/MM/YY"] as const;

const column = z.union([z.number().int().min(0), z.string().min(1)]).describe("Column index (0-based) or header name");

export const csvMapping = z.object({
  /** Rows to drop before the header (bank exports often start with account details). */
  skipRows: z.number().int().min(0).default(0),
  hasHeader: z.boolean().default(true),
  date: column,
  dateFormat: z.enum(DATE_FORMATS),
  /**
   * Year for formats without one (DD/MM): the year of the latest row. Defaults to the current WIB year (the previous one
   * when that would put the latest row in the future). A "Periode" line above the table (BCA) takes precedence. Rows of a
   * statement that crosses New Year (Dec..Jan) take the year before for the late months.
   */
  year: z.number().int().optional(),
  /** Joined with a space: some banks split the description over several columns. */
  description: z.array(column).min(1),
  /** One signed column (or with DB/CR markers), or separate debit and credit columns. */
  amount: column.optional(),
  debit: column.optional(),
  credit: column.optional(),
  /** A column holding DB/CR (or D/K, debit/kredit) beside an unsigned amount; it decides the sign. */
  marker: column.optional(),
  /** Flip the sign of `amount` (credit-card exports often list spending as positive). */
  invert: z.boolean().default(false),
  balance: column.optional(),
  reference: column.optional(),
  decimal: z.enum(["dot", "comma"]).optional(),
  /** Rows whose date cell matches this (case-insensitive) are skipped, e.g. "PEND" for pending BCA rows. */
  skipDateValues: z.array(z.string()).default([]),
});

export type CsvMapping = z.infer<typeof csvMapping>;

export type ParsedRow = {
  date: string;
  amount: number;
  description: string;
  balanceAfter?: number;
  externalRef?: string;
};

export type RowError = { line: number; message: string };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8,
  sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

const pad = (n: number) => n.toString().padStart(2, "0");

export function parseDate(raw: string, format: (typeof DATE_FORMATS)[number], year?: number): string {
  const s = raw.trim().replace(/^'/, "");
  let d: number, m: number, y: number;
  const parts = s.split(/[/\-.\s]+/);
  switch (format) {
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
      [d, m, y] = parts.map(Number) as [number, number, number];
      break;
    case "DD/MM/YY":
      [d, m, y] = parts.map(Number) as [number, number, number];
      y += 2000;
      break;
    case "MM/DD/YYYY":
      [m, d, y] = parts.map(Number) as [number, number, number];
      break;
    case "YYYY-MM-DD":
      [y, m, d] = parts.slice(0, 3).map(Number) as [number, number, number];
      break;
    case "DD/MM":
      [d, m] = parts.map(Number) as [number, number];
      y = year ?? new Date().getUTCFullYear();
      break;
    case "DD MMM YYYY": {
      d = Number(parts[0]);
      m = MONTHS[(parts[1] ?? "").slice(0, 3).toLowerCase()] ?? NaN;
      y = Number(parts[2]);
      break;
    }
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(date.getTime()) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Not a ${format} date: "${raw}"`);
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

const DATE_LIKE = /^'?\d{1,4}[/\-. ]\d{1,2}|^\d{1,2} [A-Za-z]{3}/;

/**
 * Where the column names are. Bank exports put account details above the table, so with a named date column it is the
 * first row naming it; otherwise the row above the first transaction-looking row: one with a date-like cell and at least
 * three filled cells, so a "Periode : ,01/11/2026 - 30/11/2026" line above BCA's table is not taken for a transaction.
 */
export function findHeaderRow(table: string[][], dateColumn?: string | number): number {
  if (typeof dateColumn === "string") {
    const wanted = dateColumn.trim().toLowerCase();
    const at = table.slice(0, 50).findIndex((r) => r.some((c) => c.trim().toLowerCase() === wanted));
    if (at >= 0) return at;
  }
  const first = table.findIndex((r) => r.filter((c) => c.trim()).length >= 3 && r.some((c) => DATE_LIKE.test(c.trim())));
  return first > 0 ? first - 1 : 0;
}

/**
 * The DB/CR column beside an unsigned amount when the mapping names none: the column right after the amount when its
 * header is blank. BCA's mutasi CSV is laid out this way ("Jumlah,,Saldo" with CR or DB in the unnamed column).
 */
export function adjacentMarker(header: string[], amount: number): number | undefined {
  const next = header[amount + 1];
  return next !== undefined && next.trim() === "" ? amount + 1 : undefined;
}

/** Footer lines of BCA's CSV (totals, not transactions); their first cell sits where the date is. */
export const SUMMARY_ROWS = ["Saldo Awal", "Mutasi Kredit", "Mutasi Debet", "Saldo Akhir"];

const PERIOD = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/** The statement period printed above the table ("Periode : ,01/12/2025 - 10/01/2026"), as YYYY-MM-DD bounds. */
export function findPeriod(lines: string[][]): { from: string; to: string } | undefined {
  for (const cells of lines) {
    const m = PERIOD.exec(cells.join(" "));
    if (!m) continue;
    try {
      return { from: parseDate(`${m[1]}/${m[2]}/${m[3]}`, "DD/MM/YYYY"), to: parseDate(`${m[4]}/${m[5]}/${m[6]}`, "DD/MM/YYYY") };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const wibToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Years for day/month dates (DD/MM). Order-independent: within the period when one is known; otherwise the latest row
 * gets `year` (or the current WIB year, or the one before when that is in the future) and, when the months wrap
 * around New Year (they span more than six months), the late months (Jul..Dec) get the year before.
 */
export function resolveYears(
  dayMonths: { d: number; m: number }[],
  opts: { year?: number; period?: { from: string; to: string }; today?: string },
): string[] {
  const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  if (opts.period) {
    const { from, to } = opts.period;
    const y0 = Number(from.slice(0, 4));
    const y1 = Number(to.slice(0, 4));
    return dayMonths.map(({ d, m }) => {
      for (let y = y0; y <= y1; y++) if (iso(y, m, d) >= from && iso(y, m, d) <= to) return iso(y, m, d);
      return iso(y1, m, d);
    });
  }
  if (!dayMonths.length) return [];
  const months = dayMonths.map((r) => r.m);
  const wraps = Math.max(...months) - Math.min(...months) > 6;
  const lateYearOffset = (m: number) => (wraps && m > 6 ? -1 : 0);
  let year = opts.year;
  if (year === undefined) {
    const today = opts.today ?? wibToday();
    year = Number(today.slice(0, 4));
    const latest = dayMonths
      .map(({ d, m }) => iso(year! + lateYearOffset(m), m, d))
      .reduce((a, b) => (a > b ? a : b));
    if (latest > today) year -= 1;
  }
  return dayMonths.map(({ d, m }) => iso(year! + lateYearOffset(m), m, d));
}

/** Applies a mapping to raw rows (from parseCsv or a spreadsheet). Bad rows are reported, not fatal. */
export function applyMapping(
  raw: string[][],
  mapping: CsvMapping,
  currency = "IDR",
  opts: { today?: string } = {},
): { rows: ParsedRow[]; errors: RowError[] } {
  let body = raw.slice(mapping.skipRows);
  let skipped = mapping.skipRows;
  // Bank exports put account details above the table: with a named date column, the header is the first row naming it.
  if (mapping.hasHeader && typeof mapping.date === "string") {
    const at = findHeaderRow(body, mapping.date);
    if (at > 0) {
      body = body.slice(at);
      skipped += at;
    }
  }
  const header = mapping.hasHeader ? (body[0] ?? []).map((h) => h.trim().toLowerCase()) : [];
  const start = mapping.hasHeader ? 1 : 0;
  const index = (col: string | number | undefined): number | undefined => {
    if (col === undefined) return undefined;
    if (typeof col === "number") return col;
    const at = header.indexOf(col.trim().toLowerCase());
    if (at < 0) throw new Error(`Column "${col}" is not in the header (${header.join(", ")})`);
    return at;
  };
  const cols = {
    date: index(mapping.date)!,
    description: mapping.description.map((c) => index(c)!),
    amount: index(mapping.amount),
    debit: index(mapping.debit),
    credit: index(mapping.credit),
    balance: index(mapping.balance),
    reference: index(mapping.reference),
    marker: index(mapping.marker),
  };
  if (cols.marker === undefined && cols.amount !== undefined && mapping.hasHeader) cols.marker = adjacentMarker(header, cols.amount);
  if (cols.amount === undefined && (cols.debit === undefined || cols.credit === undefined)) {
    throw new Error("Map either an amount column or both debit and credit columns");
  }
  const skip = mapping.skipDateValues.map((v) => v.toLowerCase());
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const dayMonth = mapping.dateFormat === "DD/MM";
  /** DD/MM rows wait for their year until every row is read; `line` per row for errors. */
  const pendingDates: { d: number; m: number; line: number }[] = [];
  body.slice(start).forEach((cells, i) => {
    const line = skipped + start + i + 1;
    const cell = (at: number | undefined) => (at === undefined ? "" : (cells[at] ?? "").trim());
    const dateCell = cell(cols.date);
    if (!dateCell || skip.includes(dateCell.replace(/^'/, "").toLowerCase())) return;
    try {
      let date: string;
      if (dayMonth) {
        // 2000 is a leap year, so 29/02 passes here and is checked against the real year below.
        date = parseDate(dateCell, "DD/MM", 2000);
      } else date = parseDate(dateCell, mapping.dateFormat, mapping.year);
      let amount: number;
      if (cols.amount !== undefined) {
        amount = parseAmount(cell(cols.amount), currency, mapping.decimal);
        const marker = cell(cols.marker).toUpperCase();
        if (/^(DB|D|DEBIT|DEBET)$/.test(marker)) amount = -Math.abs(amount);
        else if (/^(CR|C|K|CREDIT|KREDIT)$/.test(marker)) amount = Math.abs(amount);
        if (mapping.invert) amount = -amount;
      } else {
        const debit = cell(cols.debit);
        const credit = cell(cols.credit);
        const out = debit && !/^0+([.,]0+)?$/.test(debit) ? Math.abs(parseAmount(debit, currency, mapping.decimal)) : 0;
        const inn = credit && !/^0+([.,]0+)?$/.test(credit) ? Math.abs(parseAmount(credit, currency, mapping.decimal)) : 0;
        amount = inn - out;
      }
      const description = cols.description.map(cell).filter(Boolean).join(" ").replace(/\s+/g, " ");
      if (!description) throw new Error("Empty description");
      const balance = cell(cols.balance);
      const row: ParsedRow = { date, amount, description };
      if (balance) row.balanceAfter = parseAmount(balance, currency, mapping.decimal);
      const ref = cell(cols.reference);
      if (ref) row.externalRef = ref;
      rows.push(row);
      if (dayMonth) pendingDates.push({ d: Number(date.slice(8, 10)), m: Number(date.slice(5, 7)), line });
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  });
  if (!dayMonth) return { rows, errors };
  const period = findPeriod(raw.slice(0, skipped + start));
  const dates = resolveYears(pendingDates, { year: mapping.year, period, today: opts.today });
  const kept: ParsedRow[] = [];
  rows.forEach((row, i) => {
    const date = dates[i]!;
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1) {
      errors.push({ line: pendingDates[i]!.line, message: `Not a date: ${pad(d)}/${pad(m)}/${y}` });
      return;
    }
    kept.push({ ...row, date });
  });
  errors.sort((a, b) => a.line - b.line);
  return { rows: kept, errors };
}

/**
 * Starting points per institution. Only BCA's KlikBCA CSV layout is a known format; the others are guesses to be
 * checked against a real export and corrected in the import screen (the corrected mapping is saved per household).
 * PDF statements from any of these go through Claude (MCP import_transactions) instead.
 */
export const MAPPING_PRESETS: Record<string, { label: string; mapping: CsvMapping; verified: boolean }> = {
  bca: {
    label: "BCA (KlikBCA CSV)",
    verified: false,
    mapping: {
      skipRows: 0,
      hasHeader: true,
      date: "Tanggal Transaksi",
      dateFormat: "DD/MM",
      description: ["Keterangan"],
      amount: "Jumlah",
      invert: false,
      balance: "Saldo",
      decimal: "dot",
      // CR/DB sits in the unnamed column after Jumlah (or after the amount itself); see adjacentMarker.
      skipDateValues: ["PEND", ...SUMMARY_ROWS],
    },
  },
  generic_debit_credit: {
    label: "Generic: date, description, debit, credit, balance",
    verified: false,
    mapping: {
      skipRows: 0,
      hasHeader: true,
      date: 0,
      dateFormat: "DD/MM/YYYY",
      description: [1],
      debit: 2,
      credit: 3,
      balance: 4,
      invert: false,
      skipDateValues: [],
    },
  },
  generic_signed: {
    label: "Generic: date, description, signed amount",
    verified: false,
    mapping: {
      skipRows: 0,
      hasHeader: true,
      date: 0,
      dateFormat: "YYYY-MM-DD",
      description: [1],
      amount: 2,
      invert: false,
      skipDateValues: [],
    },
  },
};
