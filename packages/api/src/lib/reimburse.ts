// Reimbursement claims ("Diganti kantor"), the pure part: amounts in words (terbilang), claim totals, the claim number,
// the snapshot a report is printed from, and its CSV. The services (services/reimburse.ts) do the database work and
// lib/claim-pdf.ts draws the PDF from the same snapshot.

import { exponentOf, formatMoney } from "./money";

// ------------------------------------------------------------------------------------------------ terbilang

const ONES = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

/** 0 < n < 1000 in words: 125 = "seratus dua puluh lima". */
function under1000(n: number): string {
  if (n < 12) return ONES[n]!;
  if (n < 20) return `${ONES[n - 10]} belas`;
  if (n < 100) {
    const rest = n % 10;
    return `${ONES[Math.floor(n / 10)]} puluh${rest ? ` ${ONES[rest]}` : ""}`;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${hundreds === 1 ? "seratus" : `${ONES[hundreds]} ratus`}${rest ? ` ${under1000(rest)}` : ""}`;
}

const SCALES: [number, string][] = [
  [1e12, "triliun"],
  [1e9, "miliar"],
  [1e6, "juta"],
  [1e3, "ribu"],
];

/**
 * A whole number in Indonesian words: 0 = "nol", 1000 = "seribu", 1500000 = "satu juta lima ratus ribu",
 * 25250 = "dua puluh lima ribu dua ratus lima puluh". Negative numbers get "minus".
 */
export function terbilang(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Not a number");
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "nol";
  if (n >= 1e15) throw new Error("Too large");
  const parts: string[] = [];
  for (const [size, word] of SCALES) {
    const count = Math.floor(n / size);
    if (!count) continue;
    n -= count * size;
    // "seribu", but "satu juta", "satu miliar".
    parts.push(size === 1e3 && count === 1 ? "seribu" : `${under1000(count)} ${word}`);
  }
  if (n) parts.push(under1000(n));
  return `${value < 0 ? "minus " : ""}${parts.join(" ")}`;
}

const CURRENCY_WORDS: Record<string, [string, string]> = { IDR: ["rupiah", "sen"], USD: ["dolar Amerika Serikat", "sen"], SGD: ["dolar Singapura", "sen"], MYR: ["ringgit", "sen"] };

/** An amount in minor units in words, capitalised: 2550000 IDR = "Dua puluh lima ribu lima ratus rupiah". */
export function amountInWords(minor: number, currency = "IDR"): string {
  const exp = exponentOf(currency);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = abs % 10 ** exp;
  const [unit, sub] = CURRENCY_WORDS[currency.toUpperCase()] ?? [currency.toUpperCase(), "sen"];
  const text = `${minor < 0 ? "minus " : ""}${terbilang(whole)} ${unit}${frac ? ` ${terbilang(frac)} ${sub}` : ""}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ------------------------------------------------------------------------------------------------ totals

export type ClaimLine = { amount: number; category: string | null };

/**
 * Subtotals per category (largest first, "Tanpa kategori" for none) and the grand total. Amounts are positive minor
 * units: what the employer owes. A refund inside a claim (a positive ledger amount) arrives here negative.
 */
export function claimTotals(lines: readonly ClaimLine[]): { subtotals: { category: string; amount: number; count: number }[]; total: number } {
  const by = new Map<string, { amount: number; count: number }>();
  let total = 0;
  for (const l of lines) {
    const key = l.category?.trim() || "Tanpa kategori";
    const s = by.get(key) ?? { amount: 0, count: 0 };
    s.amount += l.amount;
    s.count += 1;
    by.set(key, s);
    total += l.amount;
  }
  const subtotals = [...by].map(([category, s]) => ({ category, ...s })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return { subtotals, total };
}

/** RB-2026-0007: the household's 7th claim of 2026. */
export function claimNumber(year: number, sequence: number): string {
  return `RB-${year}-${String(sequence).padStart(4, "0")}`;
}

/** The next sequence from the numbers already used this year (gaps are not refilled). */
export function nextClaimSequence(existing: readonly string[], year: number): number {
  let max = 0;
  const re = new RegExp(`^RB-${year}-(\\d+)$`);
  for (const n of existing) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// ------------------------------------------------------------------------------------------------ snapshot

export type ClaimItem = {
  no: number;
  transactionId: string;
  date: string;
  merchant: string;
  description: string;
  category: string | null;
  /** The account it was paid from (payment method). */
  paidWith: string;
  /** Positive minor units owed. */
  amount: number;
  note: string | null;
  /** Receipt photos, in upload order; empty = "tanpa bukti". */
  attachmentIds: string[];
};

/** What a claim report prints, frozen when it is generated so a later download is the same document. */
export type ClaimSnapshot = {
  number: string;
  /** YYYY-MM-DD (WIB). */
  issuedOn: string;
  periodFrom: string;
  periodTo: string;
  currency: string;
  company: string;
  claimant: { name: string; employeeId: string | null; department: string | null };
  approver: { name: string | null; email: string | null };
  notes: string | null;
  items: ClaimItem[];
  subtotals: { category: string; amount: number; count: number }[];
  total: number;
  totalInWords: string;
};

/** Items in date order, numbered from 1, with totals and the amount in words. */
export function buildSnapshot(
  header: Omit<ClaimSnapshot, "items" | "subtotals" | "total" | "totalInWords" | "periodFrom" | "periodTo"> & { periodFrom?: string; periodTo?: string },
  items: readonly Omit<ClaimItem, "no">[],
): ClaimSnapshot {
  if (!items.length) throw new Error("A claim needs at least one item");
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId)).map((x, i) => ({ ...x, no: i + 1 }));
  const { subtotals, total } = claimTotals(sorted);
  return {
    ...header,
    periodFrom: header.periodFrom ?? sorted[0]!.date,
    periodTo: header.periodTo ?? sorted.at(-1)!.date,
    items: sorted,
    subtotals,
    total,
    totalInWords: amountInWords(total, header.currency),
  };
}

/** 2026-11-05 as "5 November 2026". */
export function longDate(day: string): string {
  const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Formula injection: a cell starting with = + - @ is read as a formula by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== "number" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The claim as CSV (UTF-8 with BOM so Excel reads the rupiah names right). Amounts in major units with a dot. */
export function claimCsv(s: ClaimSnapshot): string {
  const exp = exponentOf(s.currency);
  const major = (minor: number) => (minor / 10 ** exp).toFixed(exp);
  const rows: (string | number | null)[][] = [
    ["No", "Tanggal / Date", "Merchant", "Keterangan / Description", "Kategori / Category", "Metode bayar / Paid with", `Jumlah / Amount (${s.currency})`, "Bukti / Receipt", "Catatan / Note"],
    ...s.items.map((i) => [i.no, i.date, i.merchant, i.description, i.category ?? "", i.paidWith, major(i.amount), i.attachmentIds.length ? `${i.attachmentIds.length} foto` : "tanpa bukti", i.note ?? ""]),
    [],
    ...s.subtotals.map((x) => ["", "", "", "", `Subtotal ${x.category}`, "", major(x.amount), "", ""]),
    ["", "", "", "", "Total", "", major(s.total), "", s.totalInWords],
  ];
  const head = [
    ["Laporan klaim / Claim report", s.number],
    ["Tanggal / Date", s.issuedOn],
    ["Periode / Period", `${s.periodFrom} – ${s.periodTo}`],
    ["Perusahaan / Company", s.company],
    ["Pemohon / Claimant", s.claimant.name],
    ...(s.claimant.employeeId ? [["NIK / Employee ID", s.claimant.employeeId]] : []),
    ...(s.claimant.department ? [["Departemen / Department", s.claimant.department]] : []),
    ...(s.approver.name || s.approver.email ? [["Penyetuju / Approver", [s.approver.name, s.approver.email].filter(Boolean).join(" ")]] : []),
    ...(s.notes ? [["Keperluan / Purpose", s.notes]] : []),
    [],
  ];
  return `﻿${[...head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "Rp 25.000" for an item, as everywhere else. */
export function itemDisplay(minor: number, currency: string): string {
  return formatMoney(minor, currency);
}
