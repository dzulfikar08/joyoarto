// Response shapes of the JoyoArto REST API (/api/docs), written out by hand from packages/api/src/services so the
// app does not depend on the server packages. Only the fields the app reads are listed.

export type Money = { amount: number; display: string };

export type Me = {
  user: { id: string; name: string | null; email: string | null };
  household: { id: string; name: string | null; baseCurrency: string };
  scopes: string[];
  via: string;
};

export type Account = {
  id: string;
  name: string;
  institution: string | null;
  type: string;
  currency: string;
  last4: string | null;
  archived: boolean;
  balance: Money;
  transactions: number;
  lastDate: string | null;
  lastPostedDate: string | null;
  pending: number;
};

export type Category = { id: string; slug: string; name: string; kind: "expense" | "income" | "transfer" };

export type Transaction = {
  id: string;
  date: string;
  accountId: string;
  account: string;
  amount: number;
  display: string;
  currency: string;
  merchant: string | null;
  description: string;
  category: string | null;
  categoryName: string | null;
  note: string | null;
  status: "pending" | "posted";
  capturedVia: string | null;
};

export type QuickAddBody = {
  accountId?: string;
  amount?: number;
  amountText?: string;
  direction?: "in" | "out";
  description?: string;
  merchant?: string;
  category?: string;
  note?: string;
  occurredAt?: string;
  capturedVia?: "manual" | "shortcut" | "notification" | "voice" | "mcp" | "api";
  clientRef?: string;
};

export type QuickAddResult = { created: boolean; transaction: Transaction };

export type TransactionPatch = {
  id: string;
  category?: string | null;
  merchant?: string | null;
  note?: string | null;
  accountId?: string;
  amount?: number;
  description?: string;
  date?: string;
};

type Kpi = Money & { previous: Money; changePct: number | null };

export type Dashboard = {
  month: string;
  today: string;
  currency: string;
  kpis: { income: Kpi; spending: Kpi; net: Kpi };
  accounts: {
    groups: { type: string; label: string; total: Money; accounts: { id: string; name: string; institution: string | null; balance: Money; currency: string; lastDate: string | null }[] }[];
    total: Money;
  };
  attention: { pending: number; pendingStale: number; uncategorizedThisMonth: number };
};

// POST /api/imports/statement and /api/imports/statement-file (services/statements.ts).

export type JagoPocket = {
  pocket: string;
  account: string;
  accountId: string;
  createdAccount: boolean;
  rows: number;
  newRows: number;
  duplicates: number;
  inserted: number;
  reconciled: number;
  unmatchedPending: number;
  uncategorized: number;
  moneyIn: string;
  moneyOut: string;
  closing: string;
};

type Totals = { rows: number; newRows: number; duplicates: number; inserted: number; reconciled: number; unmatchedPending: number; uncategorized?: number };

export type JagoStatementResult = {
  kind: "jago";
  accountHolder: string | null;
  committed: boolean;
  problems: string[];
  balancesVerified: boolean;
  pockets: JagoPocket[];
  totals: Totals & { uncategorized: number };
  gopayMerchantsMerged: number;
  gopayPaymentsWithoutHistory: number;
  next: string;
};

export type GopayStatementResult = {
  kind: "gopay";
  committed: boolean;
  problems: string[];
  totalsVerified: boolean;
  payments: number;
  paidFromBank: number;
  bankPaymentsNamed: number;
  bankPaymentsNotImportedYet: number;
  wallet: Totals;
  next: string;
};

export type StatementResult = (JagoStatementResult | GopayStatementResult) & {
  /** Statement period, when the server reports it (the file endpoint may add it). */
  period?: { from: string | null; to: string | null } | null;
};
