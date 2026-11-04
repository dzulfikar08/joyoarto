import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";

import { formatMoney } from "../lib/money";

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const month = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");

export function notFound(what: string): never {
  throw new ORPCError("NOT_FOUND", { message: `${what} not found.` });
}

export function badRequest(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}

/** Amount in both forms: integer minor units for maths, a string for showing. */
export function money(minor: number, currency: string) {
  return { amount: minor, display: formatMoney(minor, currency) };
}

export async function getAccount(db: Database, householdId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(schema.finAccount)
    .where(and(eq(schema.finAccount.id, accountId), eq(schema.finAccount.householdId, householdId)));
  return row ?? notFound(`Account ${accountId}`);
}

export async function baseCurrency(db: Database, householdId: string): Promise<string> {
  const [row] = await db
    .select({ c: schema.household.baseCurrency })
    .from(schema.household)
    .where(eq(schema.household.id, householdId));
  return row?.c ?? "IDR";
}

/** A category by id or slug ("food/groceries"); case-insensitive slug match. */
export async function resolveCategory(db: Database, householdId: string, ref: string) {
  const [row] = await db
    .select()
    .from(schema.category)
    .where(
      and(
        eq(schema.category.householdId, householdId),
        or(eq(schema.category.id, ref), eq(schema.category.slug, ref.trim().toLowerCase())),
      ),
    );
  return row ?? notFound(`Category "${ref}" (use list_categories for valid slugs)`);
}

/** Ids of a category and all its subcategories. */
export async function categoryWithChildren(db: Database, householdId: string, ref: string): Promise<string[]> {
  const root = await resolveCategory(db, householdId, ref);
  const rows = await db
    .select({ id: schema.category.id })
    .from(schema.category)
    .where(
      and(
        eq(schema.category.householdId, householdId),
        or(eq(schema.category.id, root.id), like(schema.category.slug, `${root.slug}/%`)),
      ),
    );
  return rows.map((r) => r.id);
}

export async function categoriesById(db: Database, householdId: string) {
  const rows = await db.select().from(schema.category).where(eq(schema.category.householdId, householdId));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function accountsById(db: Database, householdId: string, ids?: string[]) {
  const where = ids?.length
    ? and(eq(schema.finAccount.householdId, householdId), inArray(schema.finAccount.id, ids.slice(0, 90)))
    : eq(schema.finAccount.householdId, householdId);
  const rows = await db.select().from(schema.finAccount).where(where);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Opaque keyset cursor over (date desc, id desc). */
export function encodeCursor(date: string, id: string): string {
  return btoa(`${date}|${id}`);
}

export function decodeCursor(cursor: string): { date: string; id: string } {
  try {
    const [date, id] = atob(cursor).split("|");
    if (!date || !id) throw new Error();
    return { date, id };
  } catch {
    return badRequest("Invalid cursor.");
  }
}
