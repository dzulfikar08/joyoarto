import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { chunk } from "../lib/d1";
import { firstMatch } from "../lib/rules";
import type { RuleLike } from "../lib/rules";
import { badRequest, categoriesById, getAccount, notFound, resolveCategory } from "./common";

const r = schema.rule;
const t = schema.transaction;

export async function loadRules(db: Database, householdId: string): Promise<RuleLike[]> {
  return db.select().from(r).where(eq(r.householdId, householdId)).orderBy(asc(r.priority), asc(r.createdAt));
}

export const ruleInput = z.object({
  field: z.enum(["merchant", "description"]).default("merchant"),
  match: z.enum(["contains", "equals", "starts_with"]).default("contains"),
  pattern: z.string().min(1).max(100).describe("Compared case-insensitively"),
  category: z.string().optional().describe("Category slug or id to set"),
  setMerchant: z.string().max(80).optional().describe("Merchant name to set"),
  accountId: z.string().optional().describe("Only for this account"),
  direction: z.enum(["in", "out"]).optional(),
  minAmount: z.number().int().min(0).optional().describe("Absolute, minor units"),
  maxAmount: z.number().int().min(0).optional().describe("Absolute, minor units"),
  priority: z.number().int().min(0).max(10000).default(100).describe("Lower runs first"),
  applyToExisting: z.boolean().default(true).describe("Also apply to past transactions that have no category yet"),
});

export async function createRule(db: Database, p: Principal, input: z.infer<typeof ruleInput>) {
  if (!input.category && !input.setMerchant) badRequest("A rule needs a category or a merchant to set.");
  const cat = input.category ? await resolveCategory(db, p.householdId, input.category) : null;
  if (input.accountId) await getAccount(db, p.householdId, input.accountId);
  const row = {
    id: crypto.randomUUID(),
    householdId: p.householdId,
    priority: input.priority,
    field: input.field,
    match: input.match,
    pattern: input.pattern.trim(),
    accountId: input.accountId ?? null,
    direction: input.direction ?? null,
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    setCategoryId: cat?.id ?? null,
    setMerchant: input.setMerchant ?? null,
    enabled: true,
  };
  await db.insert(r).values(row);
  const applied = input.applyToExisting ? await applyRulesToUncategorized(db, p.householdId, [row]) : 0;
  return { rule: viewRule(await categoriesById(db, p.householdId), row), appliedToExisting: applied };
}

/** Runs the given rules (default: all) over transactions without a category. Returns how many changed. */
export async function applyRulesToUncategorized(db: Database, householdId: string, rules?: RuleLike[]): Promise<number> {
  const active = rules ?? (await loadRules(db, householdId));
  if (!active.length) return 0;
  const open = await db
    .select({ id: t.id, accountId: t.accountId, amount: t.amount, description: t.description, merchant: t.merchant })
    .from(t)
    .where(and(eq(t.householdId, householdId), isNull(t.categoryId)))
    .limit(10000);
  const groups = new Map<string, { rule: RuleLike; ids: string[] }>();
  for (const tx of open) {
    const rule = firstMatch(active, tx);
    if (!rule || !rule.setCategoryId) continue;
    const g = groups.get(rule.id) ?? { rule, ids: [] };
    g.ids.push(tx.id);
    groups.set(rule.id, g);
  }
  let changed = 0;
  for (const { rule, ids } of groups.values()) {
    for (const part of chunk(ids, 90)) {
      const set: Partial<typeof t.$inferInsert> = { categoryId: rule.setCategoryId, categorySource: "rule", ruleId: rule.id };
      if (rule.setMerchant) set.merchant = rule.setMerchant;
      const res = await db.update(t).set(set).where(and(eq(t.householdId, householdId), inArray(t.id, part))).returning({ id: t.id });
      changed += res.length;
    }
  }
  return changed;
}

function viewRule(cats: Awaited<ReturnType<typeof categoriesById>>, rule: RuleLike) {
  const cat = rule.setCategoryId ? cats.get(rule.setCategoryId) : undefined;
  return {
    id: rule.id,
    when: `${rule.field} ${rule.match.replace("_", " ")} "${rule.pattern}"`,
    priority: rule.priority,
    accountId: rule.accountId,
    direction: rule.direction,
    minAmount: rule.minAmount,
    maxAmount: rule.maxAmount,
    category: cat?.slug ?? null,
    setMerchant: rule.setMerchant,
    enabled: rule.enabled,
  };
}

export async function listRules(db: Database, p: Principal) {
  const [rules, cats] = await Promise.all([loadRules(db, p.householdId), categoriesById(db, p.householdId)]);
  return { rules: rules.map((rule) => viewRule(cats, rule)) };
}

export async function deleteRule(db: Database, p: Principal, id: string) {
  const res = await db.delete(r).where(and(eq(r.id, id), eq(r.householdId, p.householdId))).returning({ id: r.id });
  if (!res.length) notFound(`Rule ${id}`);
  return { deleted: id };
}
