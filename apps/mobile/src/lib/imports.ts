// Import screen logic: the statement batch (status per PDF, save order, the combined result), the import log, and the
// email-in card's recent emails. Web: apps/web/src/routes/-statement-import.tsx, accounts.tsx (Recent imports) and
// -email-import.tsx. Pure, unit-tested.

import { plural } from "./format";
import type { StatementResult } from "./types";

// ------------------------------------------------------------------------------------------------ statement batch

export type BatchEntry = {
  key: string;
  name: string;
  busy: "checking" | "saving" | null;
  preview?: StatementResult;
  previewError?: string;
  /** The server can't read this kind of statement yet: offer "Request support". */
  unsupported?: boolean;
  result?: StatementResult;
  saveError?: string;
};

export type EntryStatus = "checking" | "saving" | "unsupported" | "failed" | "problems" | "nothing-new" | "ready" | "saved" | "save-failed";
export type StatusTone = "muted" | "primary" | "positive" | "warning" | "destructive";

export const ENTRY_STATUS: Record<EntryStatus, { label: string; tone: StatusTone }> = {
  checking: { label: "Checking…", tone: "muted" },
  saving: { label: "Saving…", tone: "primary" },
  unsupported: { label: "Not supported yet", tone: "warning" },
  failed: { label: "Check failed", tone: "destructive" },
  problems: { label: "Doesn't add up", tone: "warning" },
  "nothing-new": { label: "Already in", tone: "muted" },
  ready: { label: "Ready", tone: "positive" },
  saved: { label: "Saved", tone: "positive" },
  "save-failed": { label: "Not saved", tone: "destructive" },
};

export function verified(r: StatementResult): boolean {
  return (r.kind === "jago" ? r.balancesVerified : r.totalsVerified) && r.problems.length === 0;
}

export function newRows(r: StatementResult): number {
  return r.kind === "jago" ? (r.committed ? r.totals.inserted : r.totals.newRows) : r.committed ? r.wallet.inserted : r.wallet.newRows;
}

export function entryStatus(e: BatchEntry): EntryStatus {
  if (e.busy) return e.busy;
  if (e.result?.committed) return "saved";
  if (e.unsupported) return "unsupported";
  if (e.previewError) return "failed";
  if (!e.preview) return "checking";
  if (!verified(e.preview)) return "problems";
  if (e.saveError) return "save-failed";
  return newRows(e.preview) > 0 ? "ready" : "nothing-new";
}

export const canSave = (s: EntryStatus) => s === "ready" || s === "save-failed";

/**
 * The order to save a batch in: GoPay e-statements first, then Jago statements, each oldest first. GoPay first lets
 * the Jago "Gopay - Generic" payments arrive already named, so household rules see the real merchant (the web's
 * commitOrder, apps/web/src/lib/statement-batch.ts).
 */
export function saveOrder<T extends BatchEntry>(entries: readonly T[]): T[] {
  const rank = (e: T) => (e.preview?.kind === "gopay" ? 0 : e.preview?.kind === "jago" ? 1 : 2);
  const from = (e: T) => e.preview?.period?.from ?? "";
  return [...entries].sort((x, y) => rank(x) - rank(y) || from(x).localeCompare(from(y)));
}

/** "Bank Jago · 58 rows · 55 new · 3 already in". */
export function entryFacts(r: StatementResult): string[] {
  if (r.kind === "jago") {
    const facts = ["Bank Jago", plural(r.pockets.length, "pocket"), `${r.totals.rows} rows`, `${newRows(r)} new`, `${r.totals.duplicates} already in`];
    if (r.totals.reconciled) facts.push(`${r.totals.reconciled} confirm quick adds`);
    return facts;
  }
  const facts = ["GoPay", plural(r.payments, "payment"), `${newRows(r)} new from GoPay balance`, `${r.wallet.duplicates} already in`];
  if (r.paidFromBank) facts.push(`${r.paidFromBank} paid from Jago`);
  return facts;
}

export type BatchSummary = { title: string; lines: string[] };

/** The combined result after saving a batch (the web's BatchResult). */
export function batchSummary(saved: readonly StatementResult[], notSaved: readonly string[] = []): BatchSummary {
  let inserted = 0;
  let duplicates = 0;
  let named = 0;
  let reconciled = 0;
  let unmatched = 0;
  let created = 0;
  let waiting = 0;
  for (const r of saved) {
    if (r.kind === "jago") {
      inserted += r.totals.inserted;
      duplicates += r.totals.duplicates;
      // The service counts named rows before dedupe; a statement that was already in names nothing new.
      if (r.totals.inserted > 0) named += r.gopayMerchantsMerged;
      reconciled += r.totals.reconciled;
      unmatched += r.totals.unmatchedPending;
      created += r.pockets.filter((p) => p.createdAccount).length;
      waiting += r.gopayPaymentsWithoutHistory;
    } else {
      inserted += r.wallet.inserted;
      duplicates += r.wallet.duplicates;
      named += r.bankPaymentsNamed;
      reconciled += r.wallet.reconciled;
      unmatched += r.wallet.unmatchedPending;
    }
  }
  const lines: string[] = [];
  if (named > 0) lines.push(`${plural(named, "GoPay payment")} named after the real merchant.`);
  if (created > 0) lines.push(`${plural(created, "account")} created for new Jago pockets.`);
  if (reconciled > 0) lines.push(`${plural(reconciled, "quick add")} confirmed by the statement.`);
  if (unmatched > 0) lines.push(`${plural(unmatched, "quick add")} in these months matched nothing; they stay pending.`);
  if (waiting > 0) lines.push(`${plural(waiting, "GoPay payment")} still wait for the GoPay e-statement of that month.`);
  if (notSaved.length) lines.push(`Not saved: ${notSaved.join(", ")}.`);
  return { title: `Saved ${plural(saved.length, "statement")}: ${plural(inserted, "new transaction")}, ${duplicates} already in.`, lines };
}

// ------------------------------------------------------------------------------------------------ import log

export type ImportLogRow = {
  id: string;
  accountId: string;
  source: string;
  fileName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  insertedCount: number;
  duplicateCount: number;
};

export function importLogText(i: ImportLogRow, accountName: string | undefined): { title: string; subtitle: string } {
  const period = i.periodFrom ? `${i.periodFrom} → ${i.periodTo ?? i.periodFrom}` : null;
  return {
    title: `${accountName ?? "Unknown account"} · ${i.fileName ?? i.source}`,
    subtitle: [period, `${i.insertedCount} added, ${plural(i.duplicateCount, "duplicate")}`].filter(Boolean).join(" · "),
  };
}

export function undoPrompt(i: Pick<ImportLogRow, "insertedCount">): string {
  return `Delete the ${plural(i.insertedCount, "transaction")} this import added? Quick adds it confirmed go back to pending.`;
}

export function undoDoneText(r: { removed: number; restoredToPending: number }): string {
  return r.restoredToPending ? `Removed ${r.removed}; ${r.restoredToPending} back to pending.` : `Removed ${plural(r.removed, "transaction")}.`;
}

// ------------------------------------------------------------------------------------------------ email in

export const INBOUND_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  imported: { label: "Imported", tone: "positive" },
  partial: { label: "Partly imported", tone: "warning" },
  failed: { label: "Not imported", tone: "destructive" },
  no_pdf: { label: "No PDF", tone: "warning" },
  rejected_sender: { label: "Ignored: not a member", tone: "muted" },
  forwarding_confirmation: { label: "Gmail confirmation", tone: "primary" },
};

export function inboundStatus(status: string): { label: string; tone: StatusTone } {
  return INBOUND_STATUS[status] ?? { label: status, tone: "muted" };
}

type InboundDetail = { code?: string; files?: { name: string; ok: boolean; newRows?: number; message?: string }[] } | null;

/** The line under a received email: the Gmail confirmation code, or what happened to each PDF. */
export function describeInbound(status: string, detail: unknown): string {
  const d = (detail && typeof detail === "object" ? detail : null) as InboundDetail;
  if (status === "forwarding_confirmation" && d?.code) return `Confirmation code ${d.code}: enter it in Gmail's forwarding settings.`;
  if (!d?.files?.length) return "";
  return d.files.map((f) => (f.ok ? `${f.name}: ${f.newRows ?? 0} new` : `${f.name}: ${f.message ?? "not imported"}`)).join(" · ");
}
