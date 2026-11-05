import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { FileStore, Principal } from "../context";
import { purgeTransactionFiles } from "./attachments";
import { MAPPING_PRESETS, applyMapping, csvMapping, parseCsv } from "../lib/csv";
import type { ParsedRow, RowError } from "../lib/csv";
import { addDays } from "../lib/dashboard";
import { chunk, rowsPerInsert } from "../lib/d1";
import { dedupeKeys } from "../lib/dedupe";
import { cleanMerchant } from "../lib/merchant";
import { isGenericMerchant, matchPending, MATCH_WINDOW_DAYS } from "../lib/reconcile";
import { applyRule, firstMatch } from "../lib/rules";
import { badRequest, categoriesById, day, getAccount, money } from "./common";
import { loadRules } from "./rules";

const t = schema.transaction;
const MAX_ROWS = 2000;

export const importRow = z.object({
  date: day.describe("Transaction date as printed, YYYY-MM-DD"),
  amount: z.number().int().describe("Signed minor units from the account's view: negative = out (debit), positive = in (credit)"),
  description: z.string().min(1).max(500).describe("The statement's description, verbatim"),
  merchant: z.string().max(80).optional().describe("Clean counterparty name, if obvious"),
  category: z.string().optional().describe("Suggested category slug; rules take precedence"),
  balanceAfter: z.number().int().optional().describe("Running balance printed after this row, minor units"),
  externalRef: z.string().max(100).optional(),
  paymentRef: z.string().max(100).optional().describe("A payment app's id for this payment (e.g. GoPay's), used to merge its merchant details"),
});

export type ImportRow = z.infer<typeof importRow>;

export const importInput = z.object({
  accountId: z.string(),
  rows: z.array(importRow).min(1).max(MAX_ROWS).describe("In statement order"),
  commit: z.boolean().default(false).describe("false = preview only (nothing saved); true = save the new rows"),
  source: z.enum(["mcp", "csv", "xlsx", "pdf", "api", "email"]).default("api"),
  fileName: z.string().max(200).optional(),
  previewLimit: z.number().int().min(0).max(MAX_ROWS).default(20).describe("New rows to return in the preview"),
});

export const importCsvInput = z.object({
  accountId: z.string(),
  csv: z.string().max(5_000_000).optional().describe("CSV text"),
  table: z.array(z.array(z.string())).max(MAX_ROWS + 100).optional().describe("Spreadsheet rows, already split into cells"),
  preset: z.string().optional().describe(`One of: ${Object.keys(MAPPING_PRESETS).join(", ")}`),
  mappingId: z.string().optional().describe("A saved mapping"),
  mapping: csvMapping.optional(),
  saveMappingAs: z.string().max(80).optional(),
  commit: z.boolean().default(false),
  source: z.enum(["csv", "xlsx"]).default("csv"),
  fileName: z.string().max(200).optional(),
  previewLimit: z.number().int().min(0).max(MAX_ROWS).default(MAX_ROWS),
});

type BalanceCheck = { checked: number; order: "oldest_first" | "newest_first" | null; mismatches: { row: number; expected: number; printed: number }[] };

/**
 * Statements print a running balance; if the amounts we parsed do not add up to it, a sign or a digit was read wrong.
 * Rows may be oldest-first or newest-first, so both are tried and the better fit is reported.
 */
export function checkBalances(rows: readonly { amount: number; balanceAfter?: number }[]): BalanceCheck {
  const check = (dir: 1 | -1) => {
    const mismatches: BalanceCheck["mismatches"] = [];
    let checked = 0;
    for (let i = 1; i < rows.length; i++) {
      const [older, newer] = dir === 1 ? [rows[i - 1]!, rows[i]!] : [rows[i]!, rows[i - 1]!];
      if (older.balanceAfter === undefined || newer.balanceAfter === undefined) continue;
      checked++;
      const expected = older.balanceAfter + newer.amount;
      if (expected !== newer.balanceAfter) mismatches.push({ row: dir === 1 ? i : i - 1, expected, printed: newer.balanceAfter });
    }
    return { checked, mismatches };
  };
  const fwd = check(1);
  if (!fwd.checked) return { checked: 0, order: null, mismatches: [] };
  const back = check(-1);
  return fwd.mismatches.length <= back.mismatches.length
    ? { ...fwd, order: "oldest_first", mismatches: fwd.mismatches.slice(0, 20) }
    : { ...back, order: "newest_first", mismatches: back.mismatches.slice(0, 20) };
}

async function pendingRows(db: Database, householdId: string, accountId: string, from: string, to: string) {
  return db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      description: t.description,
      merchant: t.merchant,
      note: t.note,
      categoryId: t.categoryId,
      categorySource: t.categorySource,
      ruleId: t.ruleId,
      capturedVia: t.capturedVia,
      capturedAt: t.capturedAt,
      clientRef: t.clientRef,
      reimburseStatus: t.reimburseStatus,
      reimburseProfileId: t.reimburseProfileId,
      reimburseClaimId: t.reimburseClaimId,
    })
    .from(t)
    .where(and(eq(t.householdId, householdId), eq(t.accountId, accountId), eq(t.status, "pending"), gte(t.date, from), lte(t.date, to)));
}

function pendingView(x: { id: string; date: string; amount: number; currency: string; description: string; merchant: string | null }) {
  return { id: x.id, date: x.date, ...money(x.amount, x.currency), description: x.description, merchant: x.merchant };
}

export async function importTransactions(db: Database, p: Principal, input: z.infer<typeof importInput>, parseErrors: RowError[] = []) {
  const account = await getAccount(db, p.householdId, input.accountId);
  const keys = await dedupeKeys(account.id, input.rows);

  const existing = new Set<string>();
  for (const part of chunk(keys, 90)) {
    const found = await db
      .select({ k: t.dedupeKey })
      .from(t)
      .where(and(eq(t.accountId, account.id), inArray(t.dedupeKey, part)));
    for (const f of found) existing.add(f.k);
  }

  const [rules, cats] = await Promise.all([loadRules(db, p.householdId), categoriesById(db, p.householdId)]);
  const bySlug = new Map([...cats.values()].map((c) => [c.slug, c]));
  const unknownCategories = new Set<string>();

  const fresh = input.rows.flatMap((row, i) => {
    if (existing.has(keys[i]!)) return [];
    const merchant = row.merchant?.trim() || cleanMerchant(row.description);
    /** Where the merchant came from: the row itself, a rule, or only the description clean-up. */
    const merchantFrom = row.merchant?.trim() ? "row" : "clean";
    const target = { accountId: account.id, amount: row.amount, description: row.description, merchant };
    const ruled = applyRule(firstMatch(rules, target), target);
    const suggested = row.category ? (bySlug.get(row.category.trim().toLowerCase()) ?? cats.get(row.category)) : undefined;
    if (row.category && !suggested) unknownCategories.add(row.category);
    const categoryId = ruled.categoryId ?? suggested?.id ?? null;
    return [
      {
        index: i,
        merchantFrom: ruled.merchant !== merchant ? "rule" : merchantFrom,
        id: crypto.randomUUID(),
        householdId: p.householdId,
        accountId: account.id,
        date: row.date,
        amount: row.amount,
        currency: account.currency,
        description: row.description,
        merchant: ruled.merchant,
        categoryId,
        categorySource: (ruled.categoryId ? "rule" : suggested ? "import" : null) as "manual" | "rule" | "import" | null,
        ruleId: ruled.ruleId,
        balanceAfter: row.balanceAfter ?? null,
        externalRef: row.externalRef ?? null,
        paymentRef: row.paymentRef ?? null,
        dedupeKey: keys[i]!,
        createdBy: p.userId,
        status: "posted" as const,
      },
    ];
  });

  const dates = input.rows.map((r) => r.date).sort();
  const period = { from: dates[0] ?? null, to: dates.at(-1) ?? null };

  // Pending quick-add rows of this account that a statement row confirms: same amount, a day apart at most.
  const pending = period.from && period.to ? await pendingRows(db, p.householdId, account.id, addDays(period.from, -MATCH_WINDOW_DAYS), addDays(period.to, MATCH_WINDOW_DAYS)) : [];
  const matches = matchPending(
    fresh.map((r) => ({ index: r.index, date: r.date, amount: r.amount, description: r.description, merchant: r.merchant })),
    pending.map((x) => ({ ...x, capturedAt: x.capturedAt?.getTime() ?? null })),
  );
  const pendingById = new Map(pending.map((x) => [x.id, x]));
  const replaced = new Map<number, (typeof pending)[number]>();
  for (const row of fresh) {
    const m = matches.get(row.index);
    if (!m) continue;
    const pend = pendingById.get(m.id)!;
    replaced.set(row.index, pend);
    // The statement keeps its date, amount, description and balance; what the person added carries over.
    if (pend.categoryId && (!row.categoryId || row.categorySource === "import")) {
      row.categoryId = pend.categoryId;
      row.categorySource = pend.categorySource ?? "manual";
      row.ruleId = pend.ruleId;
    }
    if (pend.merchant && row.merchantFrom !== "rule" && (row.merchantFrom === "clean" || isGenericMerchant(row.merchant))) row.merchant = pend.merchant;
  }
  const unmatchedPending = pending.filter((x) => ![...matches.values()].some((m) => m.id === x.id) && x.date >= period.from! && x.date <= period.to!);
  const totalIn = fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalOut = fresh.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  let batchId: string | null = null;
  let inserted = 0;
  let reconciled = 0;
  if (input.commit && fresh.length) {
    const id = crypto.randomUUID();
    batchId = id;
    const logBatch = db.insert(schema.importBatch).values({
      id,
      householdId: p.householdId,
      accountId: account.id,
      source: input.source,
      fileName: input.fileName ?? null,
      rowCount: input.rows.length,
      insertedCount: 0,
      duplicateCount: input.rows.length - fresh.length,
      periodFrom: period.from,
      periodTo: period.to,
      createdBy: p.userId,
    });
    const values = fresh.filter((r) => !replaced.has(r.index)).map(({ index: _i, merchantFrom: _m, ...row }) => ({ ...row, importBatchId: id }));
    // 18 bound columns per row (status included: drizzle binds a literal default when it is left out). A concurrent
    // import of the same statement may have saved some rows already: those conflict on the dedupe key and are skipped.
    const statements = values.length ? chunk(values, rowsPerInsert(18)).map((part) => db.insert(t).values(part).onConflictDoNothing().returning({ id: t.id })) : [];
    const saved = (rowId: string) => sql`exists (select 1 from ${t} where ${t.id} = ${rowId})`;
    // Each confirmed pending row: insert the statement row, move its tags over, delete it, keep its clientRef. One
    // batch is one transaction, so a failure leaves the pending row as it was. When the insert is skipped (another
    // import saved the same row first), the follow-up statements match nothing and the pending row stays untouched.
    const swaps = fresh
      .filter((r) => replaced.has(r.index))
      .map(({ index, merchantFrom: _m, ...row }) => {
        const pend = replaced.get(index)!;
        return [
          db
            .insert(t)
            .values({
              ...row,
              importBatchId: id,
              note: pend.note,
              capturedVia: pend.capturedVia,
              capturedAt: pend.capturedAt,
              reimburseStatus: pend.reimburseStatus,
              reimburseProfileId: pend.reimburseProfileId,
              reimburseClaimId: pend.reimburseClaimId,
            })
            .onConflictDoNothing()
            .returning({ id: t.id }),
          db.update(schema.transactionTag).set({ transactionId: row.id }).where(and(eq(schema.transactionTag.transactionId, pend.id), saved(row.id))),
          // Receipt photos move with it (deleting the pending row would delete them).
          db.update(schema.attachment).set({ transactionId: row.id }).where(and(eq(schema.attachment.transactionId, pend.id), saved(row.id))),
          db.delete(t).where(and(eq(t.id, pend.id), eq(t.householdId, p.householdId), eq(t.status, "pending"), saved(row.id))),
          db.update(t).set({ clientRef: pend.clientRef }).where(eq(t.id, row.id)),
        ] as const;
      });
    // The import log row goes in with the first batch; at most 50 statements per batch.
    type Op = { stmt: unknown; kind: "log" | "insert" | "swap" | "other" };
    const ops: Op[] = [
      { stmt: logBatch, kind: "log" },
      ...statements.map((stmt) => ({ stmt, kind: "insert" as const })),
      ...swaps.flatMap(([ins, ...rest]) => [{ stmt: ins, kind: "swap" as const }, ...rest.map((stmt) => ({ stmt, kind: "other" as const }))]),
    ];
    // A swap's five statements must stay in one batch: cut only before an insert.
    const groups: Op[][] = [];
    for (const op of ops) {
      const last = groups.at(-1);
      const room = op.kind === "swap" ? 5 : 1;
      if (!last || (op.kind !== "other" && last.length + room > 50)) groups.push([op]);
      else last.push(op);
    }
    for (const group of groups) {
      const stmts = group.map((o) => o.stmt) as unknown as Parameters<typeof db.batch>[0];
      const results = (await db.batch(stmts)) as unknown as unknown[];
      group.forEach((o, k) => {
        const n = o.kind === "insert" || o.kind === "swap" ? (results[k] as unknown[]).length : 0;
        inserted += n;
        if (o.kind === "swap") reconciled += n;
      });
    }
    if (inserted === 0) {
      // Another import saved every row first: no empty entry in the import log.
      await db.delete(schema.importBatch).where(eq(schema.importBatch.id, id));
      batchId = null;
    } else {
      await db
        .update(schema.importBatch)
        .set({ insertedCount: inserted, duplicateCount: input.rows.length - inserted })
        .where(eq(schema.importBatch.id, id));
    }
  }

  const preview = fresh.slice(0, input.previewLimit).map((r) => {
    const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
    return {
      row: r.index,
      date: r.date,
      ...money(r.amount, r.currency),
      description: r.description,
      merchant: r.merchant,
      category: cat?.slug ?? null,
      categorySource: r.categorySource,
      /** The pending quick-add row this statement row confirms and replaces. */
      reconciles: replaced.has(r.index) ? pendingView(replaced.get(r.index)!) : null,
    };
  });

  return {
    account: { id: account.id, name: account.name },
    committed: input.commit,
    batchId,
    rows: input.rows.length,
    newRows: fresh.length,
    duplicates: input.rows.length - fresh.length,
    inserted,
    /** Statement rows that replaced a pending quick-add row (counted in newRows and inserted too). */
    reconciled: input.commit ? reconciled : replaced.size,
    /** Pending rows dated inside this statement's period that no statement row matched; they stay pending. */
    unmatchedPending: unmatchedPending.length,
    unmatchedPendingRows: unmatchedPending.slice(0, 20).map(pendingView),
    period,
    moneyIn: money(totalIn, account.currency),
    moneyOut: money(totalOut, account.currency),
    uncategorized: fresh.filter((r) => !r.categoryId).length,
    unknownCategories: [...unknownCategories],
    balanceCheck: checkBalances(input.rows),
    parseErrors: parseErrors.slice(0, 50),
    preview,
    next: input.commit
      ? fresh.some((r) => !r.categoryId)
        ? "Saved. Use search_transactions with uncategorized=true, then categorize."
        : "Saved."
      : `Preview only, nothing saved. ${replaced.size ? `${replaced.size} pending quick-add row(s) will be confirmed and replaced by statement rows. ` : ""}Check the balance check and preview, then call again with commit=true.`,
  };
}

/** CSV or spreadsheet rows through a column mapping, then the same import. */
export async function importCsv(db: Database, p: Principal, input: z.infer<typeof importCsvInput>) {
  const account = await getAccount(db, p.householdId, input.accountId);
  let mapping = input.mapping;
  if (!mapping && input.mappingId) {
    const [saved] = await db
      .select()
      .from(schema.importMapping)
      .where(and(eq(schema.importMapping.id, input.mappingId), eq(schema.importMapping.householdId, p.householdId)));
    if (!saved) badRequest(`Mapping ${input.mappingId} not found.`);
    mapping = csvMapping.parse(JSON.parse(saved.config));
  }
  if (!mapping) {
    const preset = MAPPING_PRESETS[input.preset ?? account.institution];
    if (!preset) badRequest("Choose a column mapping (preset, mappingId or mapping).");
    mapping = preset.mapping;
  }
  const table = input.table ?? (input.csv ? parseCsv(input.csv) : badRequest("Send csv or table."));
  let parsed: { rows: ParsedRow[]; errors: RowError[] };
  try {
    parsed = applyMapping(table, mapping, account.currency);
  } catch (error) {
    badRequest(error instanceof Error ? error.message : String(error));
  }
  if (!parsed.rows.length) {
    return { ...emptyResult(account), parseErrors: parsed.errors.slice(0, 50), mapping };
  }
  if (parsed.rows.length > MAX_ROWS) badRequest(`At most ${MAX_ROWS} rows per import; split the file.`);
  if (input.saveMappingAs && input.commit) {
    await db.insert(schema.importMapping).values({
      id: crypto.randomUUID(),
      householdId: p.householdId,
      name: input.saveMappingAs,
      institution: account.institution,
      config: JSON.stringify(mapping),
    });
  }
  const result = await importTransactions(
    db,
    p,
    { accountId: account.id, rows: parsed.rows, commit: input.commit, source: input.source, fileName: input.fileName, previewLimit: input.previewLimit },
    parsed.errors,
  );
  return { ...result, mapping };
}

function emptyResult(account: { id: string; name: string; currency: string }) {
  return {
    account: { id: account.id, name: account.name },
    committed: false,
    batchId: null,
    rows: 0,
    newRows: 0,
    duplicates: 0,
    inserted: 0,
    reconciled: 0,
    unmatchedPending: 0,
    unmatchedPendingRows: [] as ReturnType<typeof pendingView>[],
    period: { from: null, to: null },
    moneyIn: money(0, account.currency),
    moneyOut: money(0, account.currency),
    uncategorized: 0,
    unknownCategories: [] as string[],
    balanceCheck: { checked: 0, order: null, mismatches: [] } as BalanceCheck,
    preview: [],
    next: "No rows could be read with this mapping; see parseErrors.",
  };
}

export async function listImports(db: Database, p: Principal) {
  const rows = await db
    .select()
    .from(schema.importBatch)
    .where(eq(schema.importBatch.householdId, p.householdId))
    .orderBy(desc(schema.importBatch.createdAt))
    .limit(50);
  return { imports: rows };
}

/** Removes every transaction an import added (to redo it with a better mapping). */
export async function undoImport(db: Database, p: Principal, batchId: string, files?: FileStore) {
  const [batch] = await db
    .select()
    .from(schema.importBatch)
    .where(and(eq(schema.importBatch.id, batchId), eq(schema.importBatch.householdId, p.householdId)));
  if (!batch) badRequest(`Import ${batchId} not found.`);
  // Rows that confirmed a quick add go back to pending (keeping what the person added) instead of disappearing.
  const restored = await db
    .update(t)
    .set({ status: "pending", importBatchId: null, dedupeKey: sql`'pending:' || ${t.id}`, balanceAfter: null, externalRef: null })
    .where(and(eq(t.importBatchId, batchId), eq(t.householdId, p.householdId), isNotNull(t.capturedAt)))
    .returning({ id: t.id });
  const doomed = await db.select({ id: t.id }).from(t).where(and(eq(t.importBatchId, batchId), eq(t.householdId, p.householdId)));
  await purgeTransactionFiles(db, files, p.householdId, doomed.map((d) => d.id));
  const removed = await db.delete(t).where(and(eq(t.importBatchId, batchId), eq(t.householdId, p.householdId))).returning({ id: t.id });
  await db.delete(schema.importBatch).where(eq(schema.importBatch.id, batchId));
  return { removed: removed.length, restoredToPending: restored.length };
}

export async function listMappings(db: Database, p: Principal) {
  const saved = await db.select().from(schema.importMapping).where(eq(schema.importMapping.householdId, p.householdId));
  return {
    presets: Object.entries(MAPPING_PRESETS).map(([key, v]) => ({ key, label: v.label, verified: v.verified, mapping: v.mapping })),
    saved: saved.map((m) => ({ id: m.id, name: m.name, institution: m.institution, mapping: JSON.parse(m.config) as unknown })),
  };
}
