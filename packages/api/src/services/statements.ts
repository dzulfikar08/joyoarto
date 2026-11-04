// Bank and e-wallet statements baroka reads itself (text extracted from the PDF by the web app or a script):
// Bank Jago monthly statements (one account per pocket, every running balance verified) and GoPay e-statements
// (the real merchant behind each "Gopay - Generic" Jago payment, plus payments from GoPay balance).

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { chunk } from "../lib/d1";
import { MAX_PDF_BYTES, pdfText } from "../lib/pdf/extract";
import { classifyJago, cleanGopayName, describeJago, gopayCategory } from "../lib/statements/classify";
import { isGopayStatement, parseGopay } from "../lib/statements/gopay";
import { isJagoStatement, parseJago } from "../lib/statements/jago";
import { assertStatementImport, countStatementImport } from "./billing";
import { badRequest, categoriesById, money } from "./common";
import { importTransactions } from "./imports";
import type { ImportRow } from "./imports";

const t = schema.transaction;
const a = schema.finAccount;
const h = schema.paymentHint;

export const statementInput = z.object({
  text: z.string().min(1).max(3_000_000).describe("Text of the statement PDF, one line per text line"),
  fileName: z.string().max(200).optional(),
  commit: z.boolean().default(false).describe("false = preview only"),
});

/** multipart/form-data upload (the Android app, scripts): the PDF itself instead of its text. */
export const statementFileInput = z.object({
  file: z.file().max(MAX_PDF_BYTES).describe("The statement PDF"),
  commit: z.boolean().default(false).describe("false = preview only"),
});

/** Reads the PDF like the web app does (same pdf.js, same lines), then imports it like importStatement. */
export async function importStatementFile(db: Database, p: Principal, input: z.infer<typeof statementFileInput>, billing?: BillingConfig) {
  const read = await pdfText(new Uint8Array(await input.file.arrayBuffer()));
  if (!read.ok) throw new ORPCError("BAD_REQUEST", { message: read.message, data: { reason: read.reason } });
  const fileName = input.file.name?.slice(0, 200) || undefined;
  return importStatement(db, p, { text: read.text, fileName, commit: input.commit }, { source: "pdf", billing });
}

type PocketResult = {
  pocket: string;
  account: string;
  accountId: string | null;
  createdAccount: boolean;
  rows: number;
  newRows: number;
  duplicates: number;
  inserted: number;
  /** Rows that confirmed (replaced) a pending quick-add row. */
  reconciled: number;
  /** Pending rows in this pocket's statement period that nothing matched. */
  unmatchedPending: number;
  uncategorized: number;
  moneyIn: string;
  moneyOut: string;
  closing: string;
};

type Input = z.infer<typeof statementInput>;
/** How the statement arrived, for the import log (import_batch.source): "pdf" (app, API upload) or "email". */
type Options = { source?: "pdf" | "email"; billing?: BillingConfig };

/** First and last transaction day in the statement. */
function period(dates: string[]) {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0]!, to: sorted[sorted.length - 1]! };
}

export async function importStatement(db: Database, p: Principal, input: Input, options: Options = {}) {
  const jago = isJagoStatement(input.text);
  if (!jago && !isGopayStatement(input.text)) {
    return badRequest("Not a statement JoyoArto can read yet (Bank Jago monthly statement, GoPay e-statement). Use CSV import, or ask Claude to read it.");
  }
  // Free plan: a few statements a month (previews too, so the prompt comes before the work). Counted when rows are saved.
  await assertStatementImport(db, p.userId, options.billing);
  const source = options.source ?? "pdf";
  if (jago) {
    const res = await importJago(db, p, input, source);
    if (input.commit && res.totals.inserted > 0) await countStatementImport(db, p.userId);
    return res;
  }
  const res = await importGopay(db, p, input, source);
  if (input.commit && (res.wallet.inserted > 0 || res.bankPaymentsNamed > 0)) await countStatementImport(db, p.userId);
  return res;
}

async function hintsFor(db: Database, householdId: string, refs: string[]) {
  const out = new Map<string, typeof h.$inferSelect>();
  for (const part of chunk(refs, 90)) {
    const rows = await db.select().from(h).where(and(eq(h.householdId, householdId), inArray(h.ref, part)));
    for (const r of rows) out.set(r.ref, r);
  }
  return out;
}

async function importJago(db: Database, p: Principal, input: Input, source: "pdf" | "email") {
  const statement = parseJago(input.text);
  const active = statement.pockets.filter((pk) => pk.rows.length);
  if (!active.length) badRequest("No transactions found in this Jago statement.");
  // A row that does not add up means the text was read wrong; nothing is saved then.
  const commit = input.commit && statement.problems.length === 0;

  const refs = active.flatMap((pk) => pk.rows.map((r) => r.gopayRef).filter((x): x is string => !!x));
  const hints = await hintsFor(db, p.householdId, refs);
  const accounts = await db
    .select()
    .from(a)
    .where(and(eq(a.householdId, p.householdId), eq(a.institution, "jago")));

  const pockets: PocketResult[] = [];
  let merged = 0;
  for (const pk of active) {
    const last4 = pk.pocketId.replace(/\D/g, "").slice(-4);
    let account = accounts.find((x) => x.last4 === last4) ?? null;
    let created = false;
    if (!account && commit) {
      const id = crypto.randomUUID();
      const row = { id, householdId: p.householdId, name: `Jago · ${pk.name}`, institution: "jago", type: "bank" as const, currency: "IDR", last4, openingBalance: pk.previous };
      await db.insert(a).values(row);
      account = { ...row, archivedAt: null, createdAt: new Date() };
      accounts.push(account);
      created = true;
    }
    const rows: ImportRow[] = pk.rows.map((r) => {
      let s = classifyJago(r, statement.accountName);
      const hint = r.gopayRef ? hints.get(r.gopayRef) : undefined;
      if (hint && s.merchant === "GoPay") {
        s = { merchant: hint.merchant, category: hint.category };
        merged++;
      }
      return {
        date: r.date,
        amount: r.amount,
        description: describeJago(r),
        balanceAfter: r.balanceAfter,
        externalRef: r.ref,
        ...(r.gopayRef ? { paymentRef: r.gopayRef } : {}),
        ...(s.merchant ? { merchant: s.merchant.slice(0, 80) } : {}),
        ...(s.category ? { category: s.category } : {}),
      };
    });
    const label = account?.name ?? `Jago · ${pk.name} (new account)`;
    if (!account) {
      const inc = pk.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      pockets.push({
        pocket: pk.name, account: label, accountId: null, createdAccount: false, rows: rows.length, newRows: rows.length, duplicates: 0, inserted: 0, reconciled: 0, unmatchedPending: 0,
        uncategorized: rows.filter((r) => !r.category).length, moneyIn: money(inc, "IDR").display, moneyOut: money(inc - (pk.closing - pk.previous), "IDR").display, closing: money(pk.closing, "IDR").display,
      });
      continue;
    }
    // Statements can arrive in any order: the opening balance is the start of the earliest statement seen.
    const [{ first } = { first: null }] = await db
      .select({ first: sql<string | null>`min(${t.date})` })
      .from(t)
      .where(and(eq(t.accountId, account.id), eq(t.status, "posted")));
    const earliest = pk.rows[0]!.date;
    const res = await importTransactions(db, p, { accountId: account.id, rows, commit, source, fileName: input.fileName, previewLimit: 0 });
    if (commit && !created && res.inserted > 0 && (first === null || earliest < first)) {
      await db.update(a).set({ openingBalance: pk.previous }).where(eq(a.id, account.id));
    }
    pockets.push({
      pocket: pk.name, account: label, accountId: account.id, createdAccount: created, rows: res.rows, newRows: res.newRows, duplicates: res.duplicates,
      inserted: res.inserted, reconciled: res.reconciled, unmatchedPending: res.unmatchedPending, uncategorized: res.uncategorized, moneyIn: res.moneyIn.display, moneyOut: res.moneyOut.display, closing: money(pk.closing, "IDR").display,
    });
  }
  const sum = (k: "rows" | "newRows" | "duplicates" | "inserted" | "reconciled" | "unmatchedPending" | "uncategorized") => pockets.reduce((s, x) => s + x[k], 0);
  return {
    kind: "jago" as const,
    accountHolder: statement.accountName,
    period: period(active.flatMap((pk) => pk.rows.map((r) => r.date))),
    committed: commit,
    problems: statement.problems.slice(0, 20),
    balancesVerified: statement.problems.length === 0,
    pockets,
    totals: { rows: sum("rows"), newRows: sum("newRows"), duplicates: sum("duplicates"), inserted: sum("inserted"), reconciled: sum("reconciled"), unmatchedPending: sum("unmatchedPending"), uncategorized: sum("uncategorized") },
    gopayMerchantsMerged: merged,
    gopayPaymentsWithoutHistory: refs.length - hints.size,
    next: statement.problems.length
      ? "Balances do not add up, so nothing can be saved. The PDF text was probably extracted differently; report it."
      : commit
        ? refs.length > hints.size
          ? "Saved. Import the GoPay e-statement for the same months to name the GoPay merchants."
          : "Saved."
        : "Preview only. Every running balance was checked; call again with commit=true to save.",
  };
}

async function importGopay(db: Database, p: Principal, input: Input, source: "pdf" | "email") {
  const statement = parseGopay(input.text);
  const money_ = statement.rows.filter((r) => r.amount !== null && !/^Cashback\b/i.test(r.name));
  const viaBank = money_.filter((r) => /Jago/i.test(r.method));
  const wallet = money_.filter((r) => !/Jago/i.test(r.method));

  // Jago payments already imported that still say only "GoPay".
  const matched: { id: string; ref: string }[] = [];
  for (const part of chunk(viaBank.map((r) => r.id), 90)) {
    const rows = await db
      .select({ id: t.id, ref: t.paymentRef, merchant: t.merchant, source: t.categorySource })
      .from(t)
      .where(and(eq(t.householdId, p.householdId), inArray(t.paymentRef, part)));
    for (const r of rows) if (r.ref && r.merchant === "GoPay" && r.source !== "manual" && r.source !== "rule") matched.push({ id: r.id, ref: r.ref });
  }

  let updated = 0;
  let walletResult: Awaited<ReturnType<typeof importTransactions>> | null = null;
  if (input.commit) {
    const hintRows = viaBank.map((r) => ({
      householdId: p.householdId,
      source: "gopay",
      ref: r.id,
      date: r.date,
      amount: r.amount!,
      merchant: cleanGopayName(r.name),
      category: gopayCategory(r.name),
    }));
    for (const part of chunk(hintRows, 12)) {
      await db.insert(h).values(part).onConflictDoNothing();
    }
    const bySlug = new Map([...(await categoriesById(db, p.householdId)).values()].map((c) => [c.slug, c.id]));
    const byRef = new Map(hintRows.map((x) => [x.ref, x]));
    for (const m of matched) {
      const hint = byRef.get(m.ref)!;
      const categoryId = hint.category ? (bySlug.get(hint.category) ?? null) : null;
      await db
        .update(t)
        .set({ merchant: hint.merchant, ...(categoryId ? { categoryId, categorySource: "import" as const } : {}) })
        .where(eq(t.id, m.id));
      updated++;
    }
  }

  if (wallet.length) {
    let [walletAccount] = await db
      .select()
      .from(a)
      .where(and(eq(a.householdId, p.householdId), eq(a.institution, "gopay")));
    if (!walletAccount && input.commit) {
      const row = { id: crypto.randomUUID(), householdId: p.householdId, name: "GoPay wallet", institution: "gopay", type: "ewallet" as const, currency: "IDR", openingBalance: 0 };
      await db.insert(a).values(row);
      [walletAccount] = await db.select().from(a).where(eq(a.id, row.id));
    }
    if (walletAccount) {
      const rows: ImportRow[] = [...wallet]
        .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))
        .map((r) => {
          const category = gopayCategory(r.name);
          return {
            date: r.date,
            amount: r.amount!,
            description: `GoPay · ${r.name} · ${r.method}`.slice(0, 500),
            merchant: cleanGopayName(r.name),
            externalRef: r.id,
            ...(category ? { category } : {}),
          };
        });
      walletResult = await importTransactions(db, p, { accountId: walletAccount.id, rows, commit: input.commit, source, fileName: input.fileName, previewLimit: 0 });
    }
  }

  return {
    kind: "gopay" as const,
    period: period(statement.rows.map((r) => r.date)),
    committed: input.commit,
    problems: statement.problems,
    totalsVerified: statement.problems.length === 0,
    payments: money_.length,
    paidFromBank: viaBank.length,
    bankPaymentsNamed: input.commit ? updated : matched.length,
    bankPaymentsNotImportedYet: viaBank.length - matched.length,
    wallet: walletResult
      ? {
          rows: walletResult.rows,
          newRows: walletResult.newRows,
          inserted: walletResult.inserted,
          duplicates: walletResult.duplicates,
          reconciled: walletResult.reconciled,
          unmatchedPending: walletResult.unmatchedPending,
          uncategorized: walletResult.uncategorized,
        }
      : { rows: wallet.length, newRows: wallet.length, inserted: 0, duplicates: 0, reconciled: 0, unmatchedPending: 0, uncategorized: 0 },
    next: input.commit
      ? "Saved. GoPay merchants are remembered, so Jago statements imported later are named too."
      : `Preview only: ${matched.length} Jago payments will get their GoPay merchant. Call again with commit=true.`,
  };
}
