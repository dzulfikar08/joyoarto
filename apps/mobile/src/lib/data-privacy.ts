// Data & privacy (web: routes/-data-privacy.tsx): the two downloads and the typed confirmations that guard deleting
// the household and the account. Pure, unit-tested.

import { SESSION_ONLY_MESSAGE } from "./errors";
import { todayWib } from "./format";

export type ExportKind = "json" | "csv";

export const EXPORTS: Record<ExportKind, { path: string; mimeType: string; uti: string; label: string }> = {
  json: { path: "/api/account/export", mimeType: "application/json", uti: "public.json", label: "Everything (JSON)" },
  csv: { path: "/api/account/export/transactions.csv", mimeType: "text/csv", uti: "public.comma-separated-values-text", label: "Transactions (CSV)" },
};

export function exportUrl(server: string, kind: ExportKind): string {
  return `${server.replace(/\/+$/, "")}${EXPORTS[kind].path}`;
}

/** "joyoarto-export-2026-11-04.json", "joyoarto-transactions-2026-11-04.csv". */
export function exportFileName(kind: ExportKind, now = new Date()): string {
  return kind === "json" ? `joyoarto-export-${todayWib(now)}.json` : `joyoarto-transactions-${todayWib(now)}.csv`;
}

/** The error text of a failed download: the server's JSON message, else the status. */
export function downloadError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { message?: unknown };
    if (typeof j.message === "string" && j.message) return /from the JoyoArto web app/i.test(j.message) ? SESSION_ONLY_MESSAGE : j.message;
  } catch {
    // not JSON
  }
  return status === 0 ? "No connection to the server." : `Server error ${status}`;
}

/** Deleting the account: the email typed must be the account's (case and spaces ignored). */
export function emailConfirmed(typed: string, email: string | null | undefined): boolean {
  return !!email && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/** Deleting the household: its name typed exactly (outer spaces ignored), as the server checks. */
export function nameConfirmed(typed: string, name: string): boolean {
  return !!name.trim() && typed.trim() === name.trim();
}
