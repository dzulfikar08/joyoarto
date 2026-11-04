import { normalizeText } from "./merchant";

export type DedupeInput = { date: string; amount: number; description: string };

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One key per row: account, date, amount, normalised description and the row's occurrence among identical rows of
 * the same input. Two identical coffees on one day get #0 and #1, so both are kept, and importing the same statement
 * again produces the same keys, so nothing is added twice. Overlapping statements (March 1-31, then March 15-April 15)
 * also line up, as long as each one contains the whole day.
 */
export async function dedupeKeys(accountId: string, rows: readonly DedupeInput[]): Promise<string[]> {
  const seen = new Map<string, number>();
  return Promise.all(
    rows.map((row) => {
      const base = `${accountId}|${row.date}|${row.amount}|${normalizeText(row.description)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return sha256(`${base}|${n}`);
    }),
  );
}
