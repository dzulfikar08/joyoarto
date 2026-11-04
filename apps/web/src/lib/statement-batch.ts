// Bulk statement import, the parts that need no network: what each file is (kind, period, rows), which GoPay payments
// the files in one batch name for each other, and the order to save them in. The server parses and verifies each
// file again on preview and commit; this only describes the batch. describeStatement (the parsers) is in
// statement-describe.ts, loaded with pdf.js.

import type { StatementKind } from "@baroka/api/lib/statements/summary";

export type StatementInfo = {
  kind: StatementKind;
  /** First and last transaction date (YYYY-MM-DD), or null without rows. */
  period: { from: string; to: string } | null;
  rows: number;
  /** Jago: GoPay transaction ids of its "Gopay - Generic" payments. GoPay: ids of the payments made from Jago. */
  gopayRefs: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026", "Sep–Oct 2026", "Dec 2025–Jan 2026". */
export function periodLabel(period: StatementInfo["period"]): string {
  if (!period) return "–";
  const m = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const from = m(period.from);
  const to = m(period.to);
  if (from === to) return from;
  return period.from.slice(0, 4) === period.to.slice(0, 4) ? `${from.slice(0, 3)}–${to}` : `${from}–${to}`;
}

/**
 * How many of each file's GoPay payments another file in the batch covers: for a Jago file, its "Gopay - Generic"
 * payments that a GoPay e-statement in the batch names; for a GoPay file, its Jago payments that a Jago statement in
 * the batch contains. Previews run before anything is saved, so the server cannot see these yet.
 */
export function crossMatches(files: { key: string; info: StatementInfo }[]): Map<string, number> {
  const gopayIds = new Set(files.filter((f) => f.info.kind === "gopay").flatMap((f) => f.info.gopayRefs));
  const jagoRefs = new Set(files.filter((f) => f.info.kind === "jago").flatMap((f) => f.info.gopayRefs));
  const out = new Map<string, number>();
  for (const f of files) {
    const other = f.info.kind === "jago" ? gopayIds : f.info.kind === "gopay" ? jagoRefs : null;
    out.set(f.key, other ? new Set(f.info.gopayRefs.filter((r) => other.has(r))).size : 0);
  }
  return out;
}

/**
 * The order to save a batch in: GoPay e-statements first, then Jago statements, each oldest first.
 *
 * Either order names the Jago "Gopay - Generic" payments (GoPay stores a hint per transaction id that later Jago
 * imports use, and also renames Jago payments already saved). GoPay first is the better one: the Jago rows then arrive
 * with the real merchant, so household rules match on it and the category goes through the normal import path. Saved
 * the other way round, the Jago rows are imported as "GoPay"; a rule that matched them then keeps them unnamed, and
 * rules for the real merchant never run.
 */
export function commitOrder<T extends { info: StatementInfo }>(files: readonly T[]): T[] {
  const rank = (k: StatementKind) => (k === "gopay" ? 0 : k === "jago" ? 1 : 2);
  return [...files].sort((x, y) => rank(x.info.kind) - rank(y.info.kind) || (x.info.period?.from ?? "").localeCompare(y.info.period?.from ?? ""));
}

/** A cheap fingerprint to spot the same statement added twice (same text, whatever the file is called). */
export function textKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** Runs `fn` over `items` with at most `limit` at a time; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
