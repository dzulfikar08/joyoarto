import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { formatMoney } from "../lib/money";
import { categoriesById, categoryWithChildren, day, money, month, notFound, resolveCategory, baseCurrency } from "./common";

const t = schema.transaction;
const c = schema.category;

/**
 * What a transaction counts as: its category's kind, or by sign when it has none (money out = expense). Transfers
 * between own accounts, top-ups and card payments are never spending or income.
 */
export const kindExpr = sql<"expense" | "income" | "transfer">`case when ${t.reimburseStatus} is not null and ${t.reimburseStatus} <> 'rejected' then 'transfer' else coalesce(${c.kind}, case when ${t.amount} < 0 then 'expense' else 'income' end) end`;

/**
 * The household's own money: not a reimbursable expense (draft, submitted, paid) nor an employer's payment. Such rows
 * are transfers into and out of the employer's receivable (services/reimburse.ts); a rejected one is own spending again.
 * kindExpr already treats them as transfers; queries that read categories directly add this.
 */
export const ownMoney = sql`(${t.reimburseStatus} is null or ${t.reimburseStatus} = 'rejected')`;
export const topSlug = sql<string | null>`case when instr(${c.slug}, '/') > 0 then substr(${c.slug}, 1, instr(${c.slug}, '/') - 1) else ${c.slug} end`;

function firstOfMonth(m: string) {
  return `${m}-01`;
}

function lastOfMonth(m: string) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

export function currentMonth(now = new Date()) {
  // Indonesia (WIB) is UTC+7; months turn over there, not in UTC.
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
}

function defaultRange(input: { from?: string; to?: string }) {
  const m = currentMonth();
  return { from: input.from ?? firstOfMonth(m), to: input.to ?? lastOfMonth(m) };
}

export const summaryInput = z.object({
  from: day.optional().describe("Default: first day of this month"),
  to: day.optional().describe("Default: last day of this month"),
  groupBy: z.enum(["category", "subcategory", "merchant", "month", "account"]).default("category"),
  kind: z.enum(["expense", "income"]).default("expense"),
  category: z.string().optional().describe("Only this category slug (and its subcategories)"),
  accountId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export async function spendingSummary(db: Database, p: Principal, input: z.infer<typeof summaryInput>) {
  const range = defaultRange(input);
  const where: (SQL | undefined)[] = [
    eq(t.householdId, p.householdId),
    gte(t.date, range.from),
    lte(t.date, range.to),
    sql`${kindExpr} = ${input.kind}`,
  ];
  if (input.accountId) where.push(eq(t.accountId, input.accountId));
  if (input.category) where.push(inArray(t.categoryId, await categoryWithChildren(db, p.householdId, input.category)));

  const key = {
    category: topSlug,
    subcategory: sql<string | null>`${c.slug}`,
    merchant: sql<string | null>`coalesce(${t.merchant}, ${t.description})`,
    month: sql<string>`substr(${t.date}, 1, 7)`,
    account: sql<string>`${t.accountId}`,
  }[input.groupBy];

  const rows = await db
    .select({ key, currency: t.currency, total: sql<number>`sum(${t.amount})`, count: sql<number>`count(*)` })
    .from(t)
    .leftJoin(c, eq(c.id, t.categoryId))
    .where(and(...where))
    .groupBy(key, t.currency);

  // Spending is reported as a positive number; refunds inside an expense category reduce it.
  const sign = input.kind === "expense" ? -1 : 1;
  const cats = await categoriesById(db, p.householdId);
  const slugName = new Map([...cats.values()].map((x) => [x.slug, x.name]));
  const accounts =
    input.groupBy === "account"
      ? new Map((await db.select().from(schema.finAccount).where(eq(schema.finAccount.householdId, p.householdId))).map((a) => [a.id, a.name]))
      : null;

  const groups = rows
    .map((r) => {
      const total = sign * Number(r.total);
      const label =
        input.groupBy === "category" || input.groupBy === "subcategory"
          ? r.key
            ? (slugName.get(r.key) ?? r.key)
            : "Uncategorized"
          : input.groupBy === "account"
            ? (accounts?.get(r.key ?? "") ?? r.key)
            : (r.key ?? "Unknown");
      return { key: r.key, label, currency: r.currency, ...money(total, r.currency), count: Number(r.count) };
    })
    .sort((a, b) => (input.groupBy === "month" ? (a.key ?? "").localeCompare(b.key ?? "") : b.amount - a.amount));

  const totals = new Map<string, number>();
  for (const g of groups) totals.set(g.currency, (totals.get(g.currency) ?? 0) + g.amount);
  return {
    from: range.from,
    to: range.to,
    kind: input.kind,
    groupBy: input.groupBy,
    total: [...totals].map(([cur, amount]) => ({ currency: cur, ...money(amount, cur) })),
    groups: groups.slice(0, input.limit).map((g) => {
      const all = totals.get(g.currency) ?? 0;
      return { ...g, share: all ? Math.round((g.amount / all) * 1000) / 10 : 0 };
    }),
    moreGroups: Math.max(0, groups.length - input.limit),
  };
}

export const cashflowInput = z.object({
  fromMonth: month.optional().describe("Default: 5 months before toMonth"),
  toMonth: month.optional().describe("Default: this month"),
  accountId: z.string().optional(),
});

export async function cashflow(db: Database, p: Principal, input: z.infer<typeof cashflowInput>) {
  const toMonth = input.toMonth ?? currentMonth();
  const fromMonth = input.fromMonth ?? shiftMonth(toMonth, -5);
  const where: (SQL | undefined)[] = [
    eq(t.householdId, p.householdId),
    gte(t.date, firstOfMonth(fromMonth)),
    lte(t.date, lastOfMonth(toMonth)),
  ];
  if (input.accountId) where.push(eq(t.accountId, input.accountId));
  const m = sql<string>`substr(${t.date}, 1, 7)`;
  const rows = await db
    .select({ month: m, kind: kindExpr, currency: t.currency, total: sql<number>`sum(${t.amount})` })
    .from(t)
    .leftJoin(c, eq(c.id, t.categoryId))
    .where(and(...where))
    .groupBy(m, kindExpr, t.currency);

  const cur = await baseCurrency(db, p.householdId);
  const months: string[] = [];
  for (let x = fromMonth; x <= toMonth; x = shiftMonth(x, 1)) months.push(x);
  const pick = (mo: string, kind: string) =>
    rows.filter((r) => r.month === mo && r.kind === kind && r.currency === cur).reduce((s, r) => s + Number(r.total), 0);
  const result = months.map((mo) => {
    const income = pick(mo, "income");
    const expense = -pick(mo, "expense");
    const net = income - expense;
    return {
      month: mo,
      income: money(income, cur),
      expense: money(expense, cur),
      net: money(net, cur),
      savingsRate: income > 0 ? Math.round((net / income) * 1000) / 10 : null,
    };
  });
  const otherCurrencies = [...new Set(rows.map((r) => r.currency).filter((x) => x !== cur))];
  return { currency: cur, months: result, ...(otherCurrencies.length ? { note: `Only ${cur} is shown; also present: ${otherCurrencies.join(", ")}.` } : {}) };
}

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export const setBudgetInput = z.object({
  category: z.string().describe("Expense category slug or id"),
  amount: z.number().int().min(0).describe("Monthly limit in minor units; 0 removes the budget"),
});

export async function setBudget(db: Database, p: Principal, input: z.infer<typeof setBudgetInput>) {
  const cat = await resolveCategory(db, p.householdId, input.category);
  if (cat.kind !== "expense") notFound(`Expense category "${input.category}"`);
  const b = schema.budget;
  if (input.amount === 0) {
    await db.delete(b).where(and(eq(b.householdId, p.householdId), eq(b.categoryId, cat.id)));
    return { category: cat.slug, removed: true };
  }
  await db
    .insert(b)
    .values({ id: crypto.randomUUID(), householdId: p.householdId, categoryId: cat.id, amount: input.amount })
    .onConflictDoUpdate({ target: [b.householdId, b.categoryId], set: { amount: input.amount } });
  const cur = await baseCurrency(db, p.householdId);
  return { category: cat.slug, monthly: money(input.amount, cur) };
}

export const budgetStatusInput = z.object({ month: month.optional().describe("Default: this month") });

export async function budgetStatus(db: Database, p: Principal, input: z.infer<typeof budgetStatusInput>) {
  const mo = input.month ?? currentMonth();
  const cur = await baseCurrency(db, p.householdId);
  const budgets = await db.select().from(schema.budget).where(eq(schema.budget.householdId, p.householdId));
  const cats = await categoriesById(db, p.householdId);
  const spent = await db
    .select({ categoryId: t.categoryId, total: sql<number>`sum(${t.amount})` })
    .from(t)
    .where(
      and(
        eq(t.householdId, p.householdId),
        eq(t.currency, cur),
        gte(t.date, firstOfMonth(mo)),
        lte(t.date, lastOfMonth(mo)),
        ownMoney,
      ),
    )
    .groupBy(t.categoryId);
  const spentBy = new Map(spent.map((s) => [s.categoryId, -Number(s.total)]));

  const daysInMonth = Number(lastOfMonth(mo).slice(8));
  const thisMonth = currentMonth();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const elapsed = mo < thisMonth ? 1 : mo > thisMonth ? 0 : Number(today.slice(8)) / daysInMonth;

  const items = budgets.map((bud) => {
    const cat = cats.get(bud.categoryId);
    const family = [...cats.values()].filter((x) => x.id === bud.categoryId || (cat && x.slug.startsWith(`${cat.slug}/`)));
    const used = family.reduce((s, x) => s + (spentBy.get(x.id) ?? 0), 0);
    const pct = bud.amount ? Math.round((used / bud.amount) * 1000) / 10 : 0;
    return {
      category: cat?.slug ?? bud.categoryId,
      name: cat?.name ?? bud.categoryId,
      budget: money(bud.amount, cur),
      spent: money(used, cur),
      remaining: money(bud.amount - used, cur),
      usedPct: pct,
      /** Where spending "should" be by today if spread evenly over the month. */
      pacePct: Math.round(elapsed * 1000) / 10,
      status: used > bud.amount ? "over" : pct > elapsed * 100 + 10 ? "ahead_of_pace" : "on_track",
    };
  });
  items.sort((a, b) => b.usedPct - a.usedPct);
  // A child budget (food/groceries) sits inside its parent's (food), whose spending already includes it: the totals
  // only count the top-most budgeted categories.
  const budgeted = new Set(items.map((i) => i.category));
  const topMost = items.filter((i) => !i.category.split("/").some((_, k, parts) => k > 0 && budgeted.has(parts.slice(0, k).join("/"))));
  const totalBudget = topMost.reduce((s, i) => s + i.budget.amount, 0);
  const totalSpent = topMost.reduce((s, i) => s + i.spent.amount, 0);
  return {
    month: mo,
    budgets: items,
    total: { budget: formatMoney(totalBudget, cur), spent: formatMoney(totalSpent, cur) },
    ...(items.length ? {} : { note: "No budgets yet. Use set_budget." }),
  };
}
