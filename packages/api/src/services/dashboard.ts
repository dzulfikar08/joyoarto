import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import {
  addDays,
  categoryComparison,
  cumulativeByDay,
  daysBetween,
  groupAccounts,
  monthBounds,
  pctChange,
  SAVINGS_RATE_MIN_INCOME_IDR,
  savingsRate,
  staleAccounts,
  todayWib,
} from "../lib/dashboard";
import { listAccounts } from "./accounts";
import { baseCurrency, categoriesById, money, month } from "./common";
import { budgetStatus, cashflow, currentMonth, kindExpr, shiftMonth, topSlug } from "./reports";

const t = schema.transaction;
const c = schema.category;

/** Pending quick-add rows older than this have most likely been missed by every statement since. */
export const PENDING_STALE_DAYS = 45;

export const dashboardInput = z.object({ month: month.optional().describe("Default: this month (WIB)") });

/**
 * Everything the home screen shows for one month, in one round trip. Every figure is in the household's base currency;
 * transfers (own accounts, top-ups, card payments, loans) are neither spending nor income. Each query binds a fixed,
 * small number of parameters, so the D1 limit is never in play.
 */
export async function dashboard(db: Database, p: Principal, input: z.infer<typeof dashboardInput>) {
  const today = todayWib();
  const mo = input.month ?? currentMonth();
  const prevMo = shiftMonth(mo, -1);
  const cur = monthBounds(mo);
  const prev = monthBounds(prevMo);
  const isCurrent = mo === today.slice(0, 7);
  const cur$ = await baseCurrency(db, p.householdId);
  // In the current month, compare like with like: the 1st to today's day number in both months. Past months compare
  // whole months. The KPIs and the per-category change use the same window.
  const cutoffDay = isCurrent ? Number(today.slice(8)) : cur.days;
  const windowEnd = isCurrent ? Math.min(cutoffDay, prev.days) : prev.days;
  const comparedTo = { from: prev.from, to: `${prevMo}-${String(windowEnd).padStart(2, "0")}` };

  const inRange = (from: string, to: string) =>
    and(eq(t.householdId, p.householdId), eq(t.currency, cur$), gte(t.date, from), lte(t.date, to));

  const [daily, byCategory, merchants, uncategorized, pending, flow, budgets, accounts, cats] = await Promise.all([
    db
      .select({ date: t.date, kind: kindExpr, total: sql<number>`sum(${t.amount})` })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(inRange(prev.from, cur.to), sql`${kindExpr} <> 'transfer'`))
      .groupBy(t.date, kindExpr),
    db
      .select({
        slug: topSlug,
        month: sql<string>`substr(${t.date}, 1, 7)`,
        total: sql<number>`sum(${t.amount})`,
        // The part of a previous-month row inside the comparison window (always 0 for the selected month).
        window: sql<number>`coalesce(sum(case when ${t.date} <= ${comparedTo.to} then ${t.amount} else 0 end), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(inRange(prev.from, cur.to), sql`${kindExpr} = 'expense'`))
      .groupBy(topSlug, sql`substr(${t.date}, 1, 7)`),
    db
      .select({ name: sql<string>`coalesce(${t.merchant}, ${t.description})`, total: sql<number>`sum(${t.amount})`, count: sql<number>`count(*)` })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(inRange(cur.from, cur.to), sql`${kindExpr} = 'expense'`))
      .groupBy(sql`coalesce(${t.merchant}, ${t.description})`)
      .orderBy(sql`sum(${t.amount})`)
      .limit(6),
    db
      .select({
        all: sql<number>`count(*)`,
        month: sql<number>`coalesce(sum(case when ${t.date} >= ${cur.from} and ${t.date} <= ${cur.to} then 1 else 0 end), 0)`,
      })
      .from(t)
      .where(and(eq(t.householdId, p.householdId), isNull(t.categoryId))),
    db
      .select({
        all: sql<number>`count(*)`,
        stale: sql<number>`coalesce(sum(case when ${t.date} < ${addDays(today, -PENDING_STALE_DAYS)} then 1 else 0 end), 0)`,
        oldest: sql<string | null>`min(${t.date})`,
      })
      .from(t)
      .where(and(eq(t.householdId, p.householdId), eq(t.status, "pending"))),
    cashflow(db, p, { fromMonth: shiftMonth(mo, -5), toMonth: mo }),
    budgetStatus(db, p, { month: mo }),
    listAccounts(db, p),
    categoriesById(db, p.householdId),
  ]);

  const sumKind = (m: string, kind: string, upTo: number) =>
    daily
      .filter((r) => r.date.startsWith(m) && r.kind === kind && Number(r.date.slice(8)) <= upTo)
      .reduce((s, r) => s + Number(r.total), 0);
  const minIncome = cur$ === "IDR" ? SAVINGS_RATE_MIN_INCOME_IDR : 0;
  const figures = (m: string, upTo: number, referenceIncome?: number) => {
    const income = sumKind(m, "income", upTo);
    const spending = -sumKind(m, "expense", upTo);
    return { income, spending, net: income - spending, savings: savingsRate(income, spending, { minIncome, referenceIncome }) };
  };
  const before = figures(prevMo, windowEnd);
  const now = figures(mo, cur.days, before.income);
  const kpi = (key: "income" | "spending" | "net") => ({
    ...money(now[key], cur$),
    previous: money(before[key], cur$),
    changePct: pctChange(now[key], before[key]),
  });

  const slugName = new Map([...cats.values()].map((x) => [x.slug, x.name]));
  const categories = categoryComparison(
    byCategory.map((r) => ({ slug: r.slug, month: r.month, total: Number(r.total), window: Number(r.window), count: Number(r.count) })),
    mo,
  ).map((x) => ({
    slug: x.slug,
    name: x.slug ? (slugName.get(x.slug) ?? x.slug) : "Uncategorized",
    ...money(x.current, cur$),
    /** Same period as the KPIs (`comparedTo`): early in a month, the same days of the previous month. */
    previous: money(x.previous, cur$),
    changePct: x.changePct,
    /** The whole previous month. */
    previousFullMonth: money(x.previousFullMonth, cur$),
    changePctFullMonth: x.changePctFullMonth,
    share: x.share,
    count: x.count,
  }));

  const expenseDaily = daily.filter((r) => r.kind === "expense").map((r) => ({ date: r.date, amount: -Number(r.total) }));
  const series = cumulativeByDay(mo, prevMo, expenseDaily, today);

  const active = accounts.accounts.filter((a) => !a.archived);
  // An account is current when a statement covers it; quick adds alone do not count.
  const byStatement = active.map((a) => ({ ...a, lastDate: a.lastPostedDate }));
  const grouped = groupAccounts(active, cur$);

  return {
    month: mo,
    previousMonth: prevMo,
    today,
    isCurrentMonth: isCurrent,
    currency: cur$,
    /** The previous-month period the KPIs are compared with. */
    comparedTo,
    kpis: {
      income: kpi("income"),
      spending: kpi("spending"),
      net: kpi("net"),
      /** null with a `note` when income so far is too small ("too-early") or the rate is outside −100%…100%. */
      savingsRate: { value: now.savings.value, previous: before.savings.value, note: now.savings.note, previousNote: before.savings.note },
    },
    categories,
    spendingByDay: series.map((d) => ({
      day: d.day,
      current: d.current === null ? null : money(d.current, cur$),
      previous: money(d.previous, cur$),
    })),
    cashflow: flow.months,
    merchants: merchants
      .filter((m) => Number(m.total) < 0)
      .map((m) => ({ name: m.name, ...money(-Number(m.total), cur$), count: Number(m.count) })),
    budgets: { items: budgets.budgets, total: budgets.total },
    accounts: {
      groups: grouped.groups.map((g) => ({
        type: g.type,
        label: g.label,
        total: money(g.total, cur$),
        accounts: g.accounts.map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: a.balance, currency: a.currency, lastDate: a.lastDate })),
      })),
      total: money(grouped.total, cur$),
    },
    attention: {
      uncategorizedThisMonth: Number(uncategorized[0]?.month ?? 0),
      uncategorizedAll: Number(uncategorized[0]?.all ?? 0),
      /** Quick-add rows (pending) no statement has confirmed; stale = dated more than PENDING_STALE_DAYS days ago. */
      pending: Number(pending[0]?.all ?? 0),
      pendingStale: Number(pending[0]?.stale ?? 0),
      pendingStaleDays: PENDING_STALE_DAYS,
      oldestPending: pending[0]?.oldest ?? null,
      staleAccounts: staleAccounts(byStatement, today).map((a) => ({
        id: a.id,
        name: a.name,
        lastDate: a.lastDate,
        daysSince: a.lastDate ? daysBetween(a.lastDate, today) : null,
      })),
    },
  };
}
