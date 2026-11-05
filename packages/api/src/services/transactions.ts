import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { CAPTURE_SOURCES } from "@baroka/db/schema/finance";
import { and, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { FileStore, Principal } from "../context";
import { counterpartyInText, directionInText, findAmountInText, parseAmountText } from "../lib/amount-text";
import { addDays, todayWib } from "../lib/dashboard";
import { chunk } from "../lib/d1";
import { dedupeKeys } from "../lib/dedupe";
import { cleanMerchant } from "../lib/merchant";
import { applyRule, firstMatch } from "../lib/rules";
import {
  accountsById,
  categoriesById,
  categoryWithChildren,
  day,
  badRequest,
  decodeCursor,
  encodeCursor,
  getAccount,
  money,
  notFound,
  resolveCategory,
} from "./common";
import { loadRules } from "./rules";
import { attachToTransaction, attachmentsByTransaction, purgeTransactionFiles } from "./attachments";
import type { AttachmentView } from "./attachments";
import { markReimbursable } from "./reimburse";

const t = schema.transaction;

export const searchInput = z.object({
  from: day.optional().describe("First day, inclusive"),
  to: day.optional().describe("Last day, inclusive"),
  accountId: z.string().optional(),
  category: z.string().optional().describe("Category slug or id; includes its subcategories"),
  uncategorized: z.boolean().optional().describe("Only transactions without a category"),
  q: z.string().max(40).optional().describe("Text in the description, merchant or note"),
  direction: z.enum(["in", "out"]).optional(),
  status: z.enum(["posted", "pending"]).optional().describe("pending = quick-add rows no statement has confirmed yet"),
  reimburse: z
    .enum(["any", "open", "draft", "submitted", "paid", "rejected", "payment", "none"])
    .optional()
    .describe("Reimbursable (\"Diganti kantor\") expenses: any marked, open = draft or submitted, a status, payment = an employer's payment, none = ordinary rows"),
  reimburseProfileId: z.string().optional(),
  hasReceipt: z.boolean().optional().describe("Only rows with (true) or without (false) a receipt photo"),
  minAmount: z.number().int().min(0).optional().describe("Minimum absolute amount, minor units"),
  maxAmount: z.number().int().min(0).optional().describe("Maximum absolute amount, minor units"),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional().describe("nextCursor of the previous page"),
});

export type TxView = {
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
  categorySource: string | null;
  note: string | null;
  /** pending: a quick add waiting for the statement; posted: from a statement or final. */
  status: "posted" | "pending";
  capturedVia: string | null;
  capturedAt: string | null;
  /** Reimbursement ("Diganti kantor"); null = an ordinary transaction. */
  reimburse: { status: "draft" | "submitted" | "paid" | "rejected" | "payment"; profileId: string | null; claimId: string | null } | null;
  /** Receipt photos (GET /api/attachments/{id}). */
  attachments: Pick<AttachmentView, "id" | "mime" | "width" | "height">[];
};

export async function searchTransactions(db: Database, p: Principal, input: z.infer<typeof searchInput>) {
  const where: (SQL | undefined)[] = [eq(t.householdId, p.householdId)];
  if (input.from) where.push(gte(t.date, input.from));
  if (input.to) where.push(lte(t.date, input.to));
  if (input.accountId) where.push(eq(t.accountId, input.accountId));
  if (input.category) where.push(inArray(t.categoryId, await categoryWithChildren(db, p.householdId, input.category)));
  if (input.uncategorized) where.push(isNull(t.categoryId));
  if (input.q?.trim()) {
    // D1 limits LIKE patterns to 50 bytes; the input is capped at 40 characters.
    const pattern = `%${input.q.trim().replace(/[%_]/g, "")}%`;
    where.push(or(like(t.description, pattern), like(t.merchant, pattern), like(t.note, pattern)));
  }
  if (input.status) where.push(eq(t.status, input.status));
  if (input.reimburse === "any") where.push(inArray(t.reimburseStatus, ["draft", "submitted", "paid", "rejected"]));
  else if (input.reimburse === "open") where.push(inArray(t.reimburseStatus, ["draft", "submitted"]));
  else if (input.reimburse === "none") where.push(isNull(t.reimburseStatus));
  else if (input.reimburse) where.push(eq(t.reimburseStatus, input.reimburse));
  if (input.reimburseProfileId) where.push(eq(t.reimburseProfileId, input.reimburseProfileId));
  if (input.hasReceipt !== undefined) {
    const has = sql`exists (select 1 from attachment where attachment.transaction_id = ${t.id})`;
    where.push(input.hasReceipt ? has : sql`not ${has}`);
  }
  if (input.direction === "in") where.push(gte(t.amount, 0));
  if (input.direction === "out") where.push(lt(t.amount, 0));
  if (input.minAmount !== undefined) where.push(gte(sql`abs(${t.amount})`, input.minAmount));
  if (input.maxAmount !== undefined) where.push(lte(sql`abs(${t.amount})`, input.maxAmount));
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    where.push(or(lt(t.date, c.date), and(eq(t.date, c.date), lt(t.id, c.id))));
  }
  const rows = await db
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.date), desc(t.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    transactions: await viewRows(db, p.householdId, page),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.date, last.id) : null,
  };
}

export async function viewRows(db: Database, householdId: string, rows: (typeof t.$inferSelect)[]): Promise<TxView[]> {
  const [cats, accounts, photos] = await Promise.all([
    categoriesById(db, householdId),
    accountsById(db, householdId, [...new Set(rows.map((r) => r.accountId))]),
    rows.length ? attachmentsByTransaction(db, householdId, rows.map((r) => r.id)) : new Map<string, AttachmentView[]>(),
  ]);
  return rows.map((r) => {
    const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
    return {
      id: r.id,
      date: r.date,
      accountId: r.accountId,
      account: accounts.get(r.accountId)?.name ?? r.accountId,
      ...money(r.amount, r.currency),
      currency: r.currency,
      merchant: r.merchant,
      description: r.description,
      category: cat?.slug ?? null,
      categoryName: cat?.name ?? null,
      categorySource: r.categorySource,
      note: r.note,
      status: r.status,
      capturedVia: r.capturedVia,
      capturedAt: r.capturedAt?.toISOString() ?? null,
      reimburse: r.reimburseStatus ? { status: r.reimburseStatus, profileId: r.reimburseProfileId, claimId: r.reimburseClaimId } : null,
      attachments: (photos.get(r.id) ?? []).map((x) => ({ id: x.id, mime: x.mime, width: x.width, height: x.height })),
    };
  });
}

export const addInput = z.object({
  accountId: z.string(),
  date: day,
  amount: z.number().int().describe("Signed minor units: negative = money out. Rp 25.000 spent = -2500000"),
  description: z.string().min(1).max(500),
  merchant: z.string().max(80).optional(),
  category: z.string().optional().describe("Category slug or id; default: rules decide"),
  note: z.string().max(500).optional(),
});

/** A manual entry (cash, or something the statement has not shown yet). Idempotent like an import row. */
export async function addTransaction(db: Database, p: Principal, input: z.infer<typeof addInput>) {
  const account = await getAccount(db, p.householdId, input.accountId);
  if (account.type === "receivable") badRequest("That is a reimbursement account; pick the account that paid.");
  const [key] = await dedupeKeys(account.id, [input]);
  const existing = await db
    .select()
    .from(t)
    .where(and(eq(t.accountId, account.id), eq(t.dedupeKey, key!)));
  if (existing[0]) return { created: false, transaction: (await viewRows(db, p.householdId, existing))[0]! };
  const merchant = input.merchant ?? cleanMerchant(input.description);
  const rules = await loadRules(db, p.householdId);
  const ruled = applyRule(firstMatch(rules, { ...input, merchant }), { ...input, merchant });
  const explicit = input.category ? await resolveCategory(db, p.householdId, input.category) : null;
  const row = {
    id: crypto.randomUUID(),
    householdId: p.householdId,
    accountId: account.id,
    date: input.date,
    amount: input.amount,
    currency: account.currency,
    description: input.description,
    merchant: ruled.merchant,
    note: input.note ?? null,
    categoryId: explicit?.id ?? ruled.categoryId,
    categorySource: explicit ? ("manual" as const) : ruled.categoryId ? ("rule" as const) : null,
    ruleId: explicit ? null : ruled.ruleId,
    dedupeKey: key!,
    createdBy: p.userId,
  };
  await db.insert(t).values(row);
  const [inserted] = await db.select().from(t).where(eq(t.id, row.id));
  return { created: true, transaction: (await viewRows(db, p.householdId, [inserted!]))[0]! };
}

export const updateInput = z.object({
  id: z.string(),
  category: z.string().nullable().optional().describe("Slug or id; null clears it"),
  merchant: z.string().max(80).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  // Pending rows only: what a quick add captured can still be fixed until the statement confirms it.
  date: day.optional().describe("Pending rows only"),
  amount: z.number().int().refine((v) => v !== 0, "Amount cannot be zero").optional().describe("Pending rows only: signed minor units"),
  description: z.string().min(1).max(500).optional().describe("Pending rows only"),
  accountId: z.string().optional().describe("Pending rows only: move it to another account"),
  reimbursable: z.boolean().optional().describe("Mark as reimbursable (Diganti kantor) or not; money out only, and not once it is in a claim"),
  reimburseProfileId: z.string().optional().describe("With reimbursable=true: the company that pays it back (default: the last used)"),
});

export async function updateTransaction(db: Database, p: Principal, input: z.infer<typeof updateInput>) {
  const [row] = await db.select().from(t).where(and(eq(t.id, input.id), eq(t.householdId, p.householdId)));
  if (!row) notFound(`Transaction ${input.id}`);
  const patch: Partial<typeof t.$inferInsert> = {};
  if (input.category !== undefined) {
    const cat = input.category === null ? null : await resolveCategory(db, p.householdId, input.category);
    patch.categoryId = cat?.id ?? null;
    patch.categorySource = cat ? "manual" : null;
    patch.ruleId = null;
  }
  if (input.merchant !== undefined) patch.merchant = input.merchant;
  if (input.note !== undefined) patch.note = input.note;
  const capturedEdit = input.date !== undefined || input.amount !== undefined || input.description !== undefined || input.accountId !== undefined;
  if (capturedEdit && row.status !== "pending") badRequest("Date, amount, description and account come from the statement and cannot be edited.");
  if (input.date !== undefined) patch.date = input.date;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.description !== undefined) patch.description = input.description;
  if (input.accountId !== undefined && input.accountId !== row.accountId) {
    const account = await getAccount(db, p.householdId, input.accountId);
    patch.accountId = account.id;
    patch.currency = account.currency;
  }
  if (Object.keys(patch).length) await db.update(t).set(patch).where(eq(t.id, row.id));
  const wantsReimburse = input.reimbursable ?? (input.reimburseProfileId ? true : undefined);
  if (wantsReimburse !== undefined) {
    const same = wantsReimburse ? row.reimburseStatus === "draft" && (!input.reimburseProfileId || input.reimburseProfileId === row.reimburseProfileId) : !row.reimburseStatus || row.reimburseStatus === "rejected";
    if (!same) await markReimbursable(db, p, { ids: [row.id], reimbursable: wantsReimburse, profileId: input.reimburseProfileId });
  }
  const [fresh] = await db.select().from(t).where(eq(t.id, row.id));
  return (await viewRows(db, p.householdId, [fresh!]))[0]!;
}

export async function deleteTransaction(db: Database, p: Principal, id: string, files?: FileStore) {
  await purgeTransactionFiles(db, files, p.householdId, [id]);
  const result = await db
    .delete(t)
    .where(and(eq(t.id, id), eq(t.householdId, p.householdId)))
    .returning({ id: t.id });
  if (!result.length) notFound(`Transaction ${id}`);
  return { deleted: id };
}

export const categorizeInput = z.object({
  ids: z.array(z.string()).min(1).max(500).describe("Transaction ids"),
  category: z.string().describe("Category slug or id"),
  merchant: z.string().max(80).optional().describe("Also rename the merchant"),
  createRule: z
    .object({
      field: z.enum(["merchant", "description"]).default("merchant"),
      match: z.enum(["contains", "equals", "starts_with"]).default("equals"),
      pattern: z.string().min(1).max(100),
      applyToExisting: z.boolean().default(true).describe("Also categorise matching past transactions that have no category"),
    })
    .optional()
    .describe("Remember this for future imports"),
});

export async function setCategory(db: Database, householdId: string, ids: string[], categoryId: string, extra: Partial<typeof t.$inferInsert> = {}) {
  let updated = 0;
  // 3 bound values besides the ids: household, category, source (+ merchant).
  for (const part of chunk(ids, 90)) {
    const res = await db
      .update(t)
      .set({ categoryId, categorySource: "manual", ruleId: null, ...extra })
      .where(and(eq(t.householdId, householdId), inArray(t.id, part)))
      .returning({ id: t.id });
    updated += res.length;
  }
  return updated;
}

export const quickAddInput = z.object({
  accountId: z.string().optional().describe("Default: the household's most used account"),
  amount: z.number().int().refine((v) => v !== 0, "Amount cannot be zero").optional().describe("Signed minor units: negative = money out. Rp 25.000 spent = -2500000"),
  amountText: z.string().max(60).optional().describe('Amount as typed or said: "25rb", "Rp 25.000", "1,5jt", "+500k". Money out unless it starts with "+" or direction=in'),
  direction: z.enum(["in", "out"]).optional().describe("For amountText/rawText: default out (spending)"),
  description: z.string().max(500).optional().describe("What it was, e.g. \"kopi kenangan\""),
  merchant: z.string().max(80).optional(),
  category: z.string().optional().describe("Category slug or id; default: rules decide"),
  note: z.string().max(500).optional(),
  occurredAt: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), "YYYY-MM-DD or an ISO date-time")
    .optional()
    .describe("When it happened (YYYY-MM-DD, or an ISO instant, read in WIB). Default: now"),
  capturedVia: z.enum(CAPTURE_SOURCES).optional().describe("Default: manual"),
  clientRef: z.string().min(1).max(100).optional().describe("Your id for this capture; sending it again returns the first row instead of adding another"),
  rawText: z
    .string()
    .max(2000)
    .optional()
    .describe("A bank or e-wallet notification body: amount, direction and merchant are read from it when not given. Never stored."),
  attachmentIds: z.array(z.string()).max(5).optional().describe("Receipt photos uploaded before (capture.receipt or POST /attachments) to keep with this row"),
  reimbursable: z.boolean().optional().describe("Money out the employer pays back (Diganti kantor): not counted as household spending"),
  reimburseProfileId: z.string().optional().describe("With reimbursable: the company; default: the last used profile"),
});

/** The account with the most transactions (ties: the one used most recently), for captures that do not say. */
export async function mostUsedAccount(db: Database, householdId: string) {
  const a = schema.finAccount;
  const [row] = await db
    .select({ id: a.id })
    .from(a)
    .leftJoin(t, eq(t.accountId, a.id))
    .where(and(eq(a.householdId, householdId), isNull(a.archivedAt), sql`${a.type} <> 'receivable'`))
    .groupBy(a.id)
    .orderBy(desc(sql`count(${t.id})`), desc(sql`max(${t.date})`), a.createdAt)
    .limit(1);
  return row ? getAccount(db, householdId, row.id) : badRequest("No account yet: create an account first, or pass accountId.");
}

/** WIB calendar day of an instant (or the day itself when only a day was given). */
function wibDay(occurredAt: string | undefined, now: Date): string {
  if (!occurredAt) return todayWib(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) return occurredAt;
  return todayWib(new Date(occurredAt));
}

/**
 * A provisional row from a quick capture (web box, Shortcut, notification, voice, Claude). It counts in reports at
 * once; the next statement import that has the same amount within a day replaces it. Idempotent with clientRef.
 */
export async function quickAdd(db: Database, p: Principal, input: z.infer<typeof quickAddInput>) {
  if (input.clientRef) {
    const existing = await db
      .select()
      .from(t)
      .where(and(eq(t.householdId, p.householdId), eq(t.clientRef, input.clientRef)));
    if (existing[0]) return { created: false, transaction: (await viewRows(db, p.householdId, existing))[0]! };
  }
  const account = input.accountId ? await getAccount(db, p.householdId, input.accountId) : await mostUsedAccount(db, p.householdId);
  if (account.type === "receivable") badRequest("That is a reimbursement account; pick the account that paid.");

  // rawText is only read here, never saved or logged.
  const raw = input.rawText?.trim() ?? "";
  let amount = input.amount;
  if (amount === undefined) {
    let parsed: ReturnType<typeof parseAmountText> | null = null;
    if (input.amountText?.trim()) {
      try {
        parsed = parseAmountText(input.amountText, account.currency);
      } catch (error) {
        badRequest(error instanceof Error ? error.message : String(error));
      }
    } else if (raw) parsed = findAmountInText(raw, account.currency);
    if (!parsed) badRequest("Send amount, amountText or a rawText that contains an amount.");
    const sign = input.direction ? (input.direction === "in" ? 1 : -1) : (parsed.sign ?? (raw ? directionInText(raw) : null) ?? -1);
    amount = sign * parsed.amount;
  }
  const merchantIn = input.merchant?.trim() || (raw && !input.description?.trim() ? counterpartyInText(raw) : null) || undefined;
  const description = input.description?.trim() || merchantIn;
  if (!description) badRequest("Send a description or merchant.");
  const merchant = merchantIn ?? cleanMerchant(description) ?? description.slice(0, 80);

  const now = new Date();
  const date = wibDay(input.occurredAt, now);
  if (date > addDays(todayWib(now), 1)) badRequest("occurredAt is in the future.");

  const target = { accountId: account.id, amount, description, merchant };
  const ruled = applyRule(firstMatch(await loadRules(db, p.householdId), target), target);
  const explicit = input.category ? await resolveCategory(db, p.householdId, input.category) : null;
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(t)
    .values({
      id,
      householdId: p.householdId,
      accountId: account.id,
      date,
      amount,
      currency: account.currency,
      description,
      merchant: input.merchant?.trim() ? merchant : ruled.merchant,
      note: input.note ?? null,
      categoryId: explicit?.id ?? ruled.categoryId,
      categorySource: explicit ? "manual" : ruled.categoryId ? "rule" : null,
      ruleId: explicit ? null : ruled.ruleId,
      dedupeKey: `pending:${id}`,
      status: "pending",
      capturedVia: input.capturedVia ?? "manual",
      capturedAt: now,
      clientRef: input.clientRef ?? null,
      createdBy: p.userId,
    })
    .onConflictDoNothing()
    .returning({ id: t.id });
  // Lost a race with a retry carrying the same clientRef: return the row that won.
  const where = inserted.length ? eq(t.id, id) : and(eq(t.householdId, p.householdId), eq(t.clientRef, input.clientRef ?? ""));
  const rows = await db.select().from(t).where(where);
  if (!rows[0]) badRequest("Could not save the transaction; try again.");
  if (inserted.length) {
    await attachToTransaction(db, p.householdId, input.attachmentIds ?? [], id);
    if (input.reimbursable && amount < 0) await markReimbursable(db, p, { ids: [id], reimbursable: true, profileId: input.reimburseProfileId });
    if (input.attachmentIds?.length || input.reimbursable) rows.splice(0, 1, ...(await db.select().from(t).where(eq(t.id, id))));
  }
  return { created: inserted.length > 0, transaction: (await viewRows(db, p.householdId, rows))[0]! };
}
