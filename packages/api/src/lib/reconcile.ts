// Matching statement rows to pending (quick-add) rows of the same account. The statement is the source of truth: a
// matched pending row is replaced by the statement row, which inherits what the person added (category, merchant,
// note, tags). Pure; the import service does the database work.

import { daysBetween } from "./dashboard";
import { normalizeText } from "./merchant";

/** A pending row may be dated up to this many days from the statement row (capture day in WIB vs booking day). */
export const MATCH_WINDOW_DAYS = 1;

export type PendingCandidate = {
  id: string;
  date: string;
  amount: number;
  description: string;
  merchant: string | null;
  /** Epoch ms; tie-break, earliest capture first. */
  capturedAt: number | null;
};

export type StatementCandidate = {
  /** Caller's index of the row. */
  index: number;
  date: string;
  amount: number;
  description: string;
  merchant: string | null;
};

const STOP = new Set(["the", "and", "dan", "di", "ke", "dari", "pt", "tbk", "cv", "id", "co", "com", "payment", "pembayaran", "transfer", "qris", "trx", "via"]);

function tokens(...texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const w of normalizeText(text ?? "").split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
    }
  }
  return out;
}

/** 0..1: how alike two rows' merchant/description texts are (shared words, a word prefix counts as shared). */
export function textSimilarity(a: { description: string; merchant: string | null }, b: { description: string; merchant: string | null }): number {
  const x = tokens(a.merchant, a.description);
  const y = tokens(b.merchant, b.description);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if ([...y].some((v) => v === w || (w.length >= 4 && v.startsWith(w)) || (v.length >= 4 && w.startsWith(v)))) shared++;
  return shared / Math.min(x.size, y.size);
}

/**
 * Pairs each statement row with at most one pending row and vice versa: exact amount, dates at most a day apart.
 * Among several candidates the closest text wins, then the closest date, then the earliest capture; pairs are taken
 * best-first over the whole statement, so one pending row is never claimed twice.
 */
export function matchPending(statement: readonly StatementCandidate[], pending: readonly PendingCandidate[]): Map<number, PendingCandidate> {
  const byAmount = new Map<number, PendingCandidate[]>();
  for (const p of pending) byAmount.set(p.amount, [...(byAmount.get(p.amount) ?? []), p]);

  const pairs: { row: StatementCandidate; p: PendingCandidate; text: number; days: number }[] = [];
  for (const row of statement) {
    for (const p of byAmount.get(row.amount) ?? []) {
      const days = Math.abs(daysBetween(p.date, row.date));
      if (days > MATCH_WINDOW_DAYS) continue;
      pairs.push({ row, p, text: textSimilarity(row, p), days });
    }
  }
  pairs.sort(
    (a, b) =>
      b.text - a.text ||
      a.days - b.days ||
      (a.p.capturedAt ?? Infinity) - (b.p.capturedAt ?? Infinity) ||
      a.row.index - b.row.index ||
      a.p.id.localeCompare(b.p.id),
  );
  const out = new Map<number, PendingCandidate>();
  const used = new Set<string>();
  for (const pair of pairs) {
    if (out.has(pair.row.index) || used.has(pair.p.id)) continue;
    out.set(pair.row.index, pair.p);
    used.add(pair.p.id);
  }
  return out;
}

/** Merchant names that say how money moved, not to whom; a person's own name for the payment beats these. */
const GENERIC_MERCHANTS = new Set(
  ["gopay", "ovo", "dana", "shopeepay", "linkaja", "qris", "transfer", "payment", "pembayaran", "purchase", "pembelian", "debit", "kartu debit", "bi-fast", "bifast", "virtual account", "va", "atm", "tarikan atm", "jago pay", "jagopay", "e-wallet", "top up", "topup"].map(
    (x) => normalizeText(x),
  ),
);

export function isGenericMerchant(merchant: string | null | undefined): boolean {
  const m = normalizeText(merchant ?? "");
  return !m || GENERIC_MERCHANTS.has(m);
}
