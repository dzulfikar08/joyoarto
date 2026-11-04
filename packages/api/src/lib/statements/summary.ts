// A summary of Jago and GoPay statements computed entirely from their text, with nothing saved: the no-account demo
// runs this in the browser. Same parsers, checks and suggestions as a real import (services/statements.ts), minus
// household rules.

import { classifyJago, cleanGopayName, gopayCategory } from "./classify";
import { isGopayStatement, parseGopay } from "./gopay";
import type { GopayStatement } from "./gopay";
import { isJagoStatement, parseJago } from "./jago";
import type { JagoStatement } from "./jago";

export type StatementKind = "jago" | "gopay" | "unknown";

export type PocketSummary = {
  name: string;
  previous: number;
  closing: number;
  moneyIn: number;
  moneyOut: number;
  rows: number;
};

export type Spend = { key: string; amount: number; count: number };

export type StatementSummary = {
  files: { name: string; kind: StatementKind; rows: number; problems: string[] }[];
  holder: string | null;
  period: { from: string; to: string } | null;
  /** Every Jago running balance and pocket total, and every GoPay total, matched the statement. */
  verified: boolean;
  problems: string[];
  pockets: PocketSummary[];
  /** Money in and out of the Jago pockets, without moves between pockets. */
  totals: { moneyIn: number; moneyOut: number; transfersOut: number };
  /** Spending (money out that is not a transfer between own accounts), largest first. Amounts are positive. */
  categories: (Spend & { key: string | "uncategorized" })[];
  merchants: Spend[];
  gopay: {
    /** Jago "Gopay - Generic" payments named from the GoPay e-statement. */
    merged: number;
    /** GoPay payments from Jago that no GoPay e-statement named. */
    unnamed: number;
    /** Payments from GoPay balance (only on the GoPay e-statement). */
    walletPayments: number;
  };
};

type Spending = { date: string; amount: number; merchant: string | null; category: string | null };

const isTransfer = (c: string | null) => c !== null && (c === "transfer" || c.startsWith("transfer/"));

export function statementKind(text: string): StatementKind {
  return isJagoStatement(text) ? "jago" : isGopayStatement(text) ? "gopay" : "unknown";
}

export function summarizeStatements(input: { name: string; text: string }[]): StatementSummary {
  const files: StatementSummary["files"] = [];
  const jago: JagoStatement[] = [];
  const gopay: GopayStatement[] = [];
  for (const f of input) {
    const kind = statementKind(f.text);
    if (kind === "jago") {
      const s = parseJago(f.text);
      jago.push(s);
      files.push({ name: f.name, kind, rows: s.pockets.reduce((n, p) => n + p.rows.length, 0), problems: s.problems });
    } else if (kind === "gopay") {
      const s = parseGopay(f.text);
      gopay.push(s);
      files.push({ name: f.name, kind, rows: s.rows.length, problems: s.problems });
    } else {
      files.push({ name: f.name, kind, rows: 0, problems: [] });
    }
  }

  // GoPay's own id ties its merchant to the Jago payment ("Gopay - Generic").
  const hints = new Map<string, { merchant: string; category: string | null }>();
  const spending: Spending[] = [];
  let walletPayments = 0;
  for (const s of gopay) {
    for (const r of s.rows) {
      if (r.amount === null || /^Cashback\b/i.test(r.name)) continue;
      hints.set(r.id, { merchant: cleanGopayName(r.name), category: gopayCategory(r.name) });
      const category = gopayCategory(r.name);
      // Paid from Jago: counted from the Jago statement, unless there is none.
      if ((!/Jago/i.test(r.method) || !jago.length) && r.amount < 0 && !isTransfer(category)) {
        spending.push({ date: r.date, amount: -r.amount, merchant: cleanGopayName(r.name), category });
        walletPayments++;
      }
    }
  }

  const pockets: PocketSummary[] = [];
  const totals = { moneyIn: 0, moneyOut: 0, transfersOut: 0 };
  let merged = 0;
  let unnamed = 0;
  const dates: string[] = [];
  for (const s of jago) {
    for (const pk of s.pockets) {
      const summary: PocketSummary = { name: pk.name, previous: pk.previous, closing: pk.closing, moneyIn: 0, moneyOut: 0, rows: pk.rows.length };
      for (const r of pk.rows) {
        dates.push(r.date);
        if (r.amount > 0) summary.moneyIn += r.amount;
        else summary.moneyOut -= r.amount;
        let sug = classifyJago(r, s.accountName);
        const betweenPockets = ["Pocket Money In", "Pocket Money Out", "Pockets", "Movement between Pockets"].includes(r.kind);
        if (sug.merchant === "GoPay" && r.gopayRef) {
          const hint = hints.get(r.gopayRef);
          if (hint) {
            sug = hint;
            merged++;
          } else unnamed++;
        }
        if (betweenPockets) continue;
        if (r.amount > 0) totals.moneyIn += r.amount;
        else if (isTransfer(sug.category)) totals.transfersOut -= r.amount;
        else {
          totals.moneyOut -= r.amount;
          spending.push({ date: r.date, amount: -r.amount, merchant: sug.merchant, category: sug.category });
        }
      }
      pockets.push(summary);
    }
  }
  for (const s of gopay) for (const r of s.rows) dates.push(r.date);
  dates.sort();

  const problems = files.flatMap((f) => f.problems.map((p) => `${f.name}: ${p}`));
  return {
    files,
    holder: jago.find((s) => s.accountName)?.accountName ?? null,
    period: dates.length ? { from: dates[0]!, to: dates.at(-1)! } : null,
    verified: files.some((f) => f.kind !== "unknown" && f.rows > 0) && problems.length === 0,
    problems,
    pockets,
    totals,
    categories: tally(spending, (x) => x.category ?? "uncategorized"),
    merchants: tally(spending, (x) => x.merchant ?? "Tanpa nama"),
    gopay: { merged, unnamed, walletPayments },
  };
}

function tally(rows: Spending[], key: (r: Spending) => string): Spend[] {
  const m = new Map<string, Spend>();
  for (const r of rows) {
    const k = key(r);
    const e = m.get(k) ?? { key: k, amount: 0, count: 0 };
    e.amount += r.amount;
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}
