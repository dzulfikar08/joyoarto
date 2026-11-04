import { schema } from "@baroka/db";
import { ACCOUNT_TYPES } from "@baroka/db/schema/finance";
import type { Database } from "@baroka/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { badRequest, getAccount, money } from "./common";
import { parentSlug } from "../lib/household";

const a = schema.finAccount;
const t = schema.transaction;

export const INSTITUTIONS = ["bca", "mandiri", "jago", "jenius", "bni", "bri", "gopay", "ovo", "dana", "shopeepay", "cash", "other"] as const;

export async function listAccounts(db: Database, p: Principal, input: { includeArchived?: boolean } = {}) {
  const where = input.includeArchived ? eq(a.householdId, p.householdId) : and(eq(a.householdId, p.householdId), isNull(a.archivedAt));
  const accounts = await db.select().from(a).where(where).orderBy(asc(a.createdAt));
  const stats = await db
    .select({
      accountId: t.accountId,
      sum: sql<number>`sum(${t.amount})`,
      count: sql<number>`count(*)`,
      last: sql<string>`max(${t.date})`,
      first: sql<string>`min(${t.date})`,
      lastPosted: sql<string | null>`max(case when ${t.status} = 'posted' then ${t.date} end)`,
      pending: sql<number>`sum(case when ${t.status} = 'pending' then 1 else 0 end)`,
    })
    .from(t)
    .where(eq(t.householdId, p.householdId))
    .groupBy(t.accountId);
  const by = new Map(stats.map((s) => [s.accountId, s]));
  return {
    accounts: accounts.map((acc) => {
      const s = by.get(acc.id);
      return {
        id: acc.id,
        name: acc.name,
        institution: acc.institution,
        type: acc.type,
        currency: acc.currency,
        last4: acc.last4,
        archived: acc.archivedAt !== null,
        /** Opening balance plus every recorded transaction (pending ones too); only right once statements cover the whole history. */
        balance: money(acc.openingBalance + Number(s?.sum ?? 0), acc.currency),
        /** What the account held before its first recorded transaction (the edit form starts from it). */
        openingBalance: money(acc.openingBalance, acc.currency),
        transactions: Number(s?.count ?? 0),
        firstDate: s?.first ?? null,
        lastDate: s?.last ?? null,
        /** Last day a statement (not a quick add) covers. */
        lastPostedDate: s?.lastPosted ?? null,
        /** Quick-add rows the next statement should confirm. */
        pending: Number(s?.pending ?? 0),
      };
    }),
  };
}

export const accountInput = z.object({
  name: z.string().min(1).max(80),
  institution: z.enum(INSTITUTIONS).default("other"),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().length(3).default("IDR"),
  last4: z.string().max(8).optional(),
  openingBalance: z.number().int().default(0).describe("Minor units, before the first recorded transaction"),
});

export async function createAccount(db: Database, p: Principal, input: z.infer<typeof accountInput>) {
  const id = crypto.randomUUID();
  await db.insert(a).values({ id, householdId: p.householdId, ...input, currency: input.currency.toUpperCase(), last4: input.last4 ?? null });
  return { id, ...input };
}

/** Only the fields sent change: no defaults here, or a partial update would reset institution and currency. */
export const accountUpdate = z.object({
  id: z.string(),
  name: z.string().min(1).max(80).optional(),
  institution: z.enum(INSTITUTIONS).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  currency: z.string().length(3).optional(),
  last4: z.string().max(8).optional(),
  openingBalance: z.number().int().optional(),
  archived: z.boolean().optional(),
});

export async function updateAccount(db: Database, p: Principal, input: z.infer<typeof accountUpdate>) {
  await getAccount(db, p.householdId, input.id);
  const { id, archived, ...rest } = input;
  const patch: Partial<typeof a.$inferInsert> = { ...rest };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  if (!Object.keys(patch).length) badRequest("Nothing to change.");
  await db.update(a).set(patch).where(and(eq(a.id, id), eq(a.householdId, p.householdId)));
  return { id, updated: true };
}

export async function listCategories(db: Database, p: Principal) {
  const rows = await db.select().from(schema.category).where(eq(schema.category.householdId, p.householdId)).orderBy(asc(schema.category.slug));
  return { categories: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, kind: r.kind })) };
}

export const categoryInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/, "lower-case words with dashes; one optional / for a subcategory (food/snacks)")
    .describe('"pets" or "food/snacks"; the parent of a subcategory must exist'),
  name: z.string().min(1).max(60),
  kind: z.enum(["expense", "income", "transfer"]).optional().describe("Default: the parent's kind, else expense"),
});

export async function createCategory(db: Database, p: Principal, input: z.infer<typeof categoryInput>) {
  const parent = parentSlug(input.slug);
  let parentRow: typeof schema.category.$inferSelect | undefined;
  if (parent) {
    [parentRow] = await db
      .select()
      .from(schema.category)
      .where(and(eq(schema.category.householdId, p.householdId), eq(schema.category.slug, parent)));
    if (!parentRow) badRequest(`Parent category "${parent}" does not exist.`);
  }
  const id = crypto.randomUUID();
  const kind = input.kind ?? parentRow?.kind ?? "expense";
  const res = await db
    .insert(schema.category)
    .values({ id, householdId: p.householdId, slug: input.slug, name: input.name, kind, parentId: parentRow?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.category.id });
  if (!res.length) badRequest(`Category "${input.slug}" already exists.`);
  return { id, slug: input.slug, name: input.name, kind };
}
