import type { ApiClient, UploadFile } from "../lib/api";
import type { StatementResult } from "../lib/types";

/**
 * Upload one shared PDF to POST /api/imports/statement-file (preview with commit=false, then commit=true).
 * `mock` answers locally with a plausible result, for development until the endpoint is deployed.
 */
export async function uploadStatement(api: ApiClient | null, file: UploadFile, commit: boolean, mock: boolean): Promise<StatementResult> {
  if (mock || !api) return mockStatementResult(file.name, commit);
  return api.uploadStatementFile(file, commit);
}

/** A per-file summary for the preview card, the same for both statement kinds. */
export type StatementSummary = {
  kind: string;
  title: string;
  period: string | null;
  newRows: number;
  duplicates: number;
  reconciled: number;
  verified: boolean;
  /** Something to say before importing (unverified balances, GoPay payments without a Jago statement). */
  notes: string[];
  lines: { label: string; value: string }[];
};

export function summarize(r: StatementResult): StatementSummary {
  const period = r.period?.from && r.period.to ? `${r.period.from} – ${r.period.to}` : null;
  if (r.kind === "jago") {
    return {
      kind: "Bank Jago",
      title: r.accountHolder ? `Bank Jago · ${r.accountHolder}` : "Bank Jago statement",
      period,
      newRows: r.totals.newRows,
      duplicates: r.totals.duplicates,
      reconciled: r.totals.reconciled,
      verified: r.balancesVerified,
      notes: [
        ...(r.balancesVerified ? [] : ["Balances do not add up, so nothing can be saved.", ...r.problems.slice(0, 3)]),
        ...(r.pockets.some((p) => p.createdAccount) ? ["New pockets become new accounts."] : []),
      ],
      lines: r.pockets.map((p) => ({ label: p.account, value: `${p.newRows} new · in ${p.moneyIn} · out ${p.moneyOut}` })),
    };
  }
  return {
    kind: "GoPay",
    title: "GoPay e-statement",
    period,
    newRows: r.wallet.newRows,
    duplicates: r.wallet.duplicates,
    reconciled: r.wallet.reconciled,
    verified: r.totalsVerified,
    notes: [
      ...(r.totalsVerified ? [] : ["Totals do not add up.", ...r.problems.slice(0, 3)]),
      ...(r.bankPaymentsNotImportedYet ? [`${r.bankPaymentsNotImportedYet} payments from Jago are not imported yet; import the Jago statement too.`] : []),
    ],
    lines: [
      { label: "Payments", value: String(r.payments) },
      { label: "Jago payments named", value: String(r.bankPaymentsNamed) },
    ],
  };
}

export function mockStatementResult(fileName: string, commit: boolean): StatementResult {
  if (/gopay/i.test(fileName)) {
    return {
      kind: "gopay",
      committed: commit,
      problems: [],
      totalsVerified: true,
      payments: 42,
      paidFromBank: 30,
      bankPaymentsNamed: 28,
      bankPaymentsNotImportedYet: 2,
      wallet: { rows: 12, newRows: 12, duplicates: 0, inserted: commit ? 12 : 0, reconciled: 3, unmatchedPending: 0 },
      period: { from: "2026-10-01", to: "2026-10-31" },
      next: commit ? "Saved." : "Preview only.",
    };
  }
  return {
    kind: "jago",
    accountHolder: "MOCK ACCOUNT",
    committed: commit,
    problems: [],
    balancesVerified: true,
    pockets: [
      { pocket: "Kantong Utama", account: "Jago · Kantong Utama", accountId: "acc_mock", createdAccount: false, rows: 58, newRows: 55, duplicates: 3, inserted: commit ? 55 : 0, reconciled: 4, unmatchedPending: 1, uncategorized: 9, moneyIn: "Rp 12.500.000", moneyOut: "Rp 9.870.500", closing: "Rp 4.120.000" },
    ],
    totals: { rows: 58, newRows: 55, duplicates: 3, inserted: commit ? 55 : 0, reconciled: 4, unmatchedPending: 1, uncategorized: 9 },
    gopayMerchantsMerged: 0,
    gopayPaymentsWithoutHistory: 6,
    period: { from: "2026-10-01", to: "2026-10-31" },
    next: commit ? "Saved." : "Preview only.",
  };
}
