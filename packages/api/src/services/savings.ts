// "Where to save" (Bisa hemat di mana): habits the household could cut and what cutting them does to the plan.
// The rules live in lib/plan/savings.ts; this reads the household's rows over the plan baseline's complete months.
import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, eq, gte, like, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { formatMoney } from "../lib/money";
import { addMonths } from "../lib/plan/months";
import { DEFAULT_HABIT_SLUGS, DEFAULT_MINIMARKET_MAX, cutEffect, cutItems, detectHabits } from "../lib/plan/savings";
import type { Habit } from "../lib/plan/savings";
import { DEFAULT_RULES } from "../lib/plan/simulate";
import { categoriesById, money } from "./common";
import { computeBaseline, resolveSimulateInput, simBaseline, simulatePlanInput, startOf } from "./plan";
import { kindExpr } from "./reports";

const t = schema.transaction;
const c = schema.category;

/** Text matched in SQL to narrow the rows; lib/plan/savings.ts MINIMARKET decides. */
const MINIMARKET_LIKE = ["indomaret", "alfamart", "alfa mart", "alfamidi", "alfa midi", "lawson", "familymart", "family mart", "circle k"];

export const savingsInput = simulatePlanInput.extend({
  categories: z
    .array(z.string().min(1).max(80))
    .max(20)
    .optional()
    .describe(`Category slugs to look at (their subcategories count too). Default: ${DEFAULT_HABIT_SLUGS.join(", ")}`),
  minimarketMax: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Largest minimarket basket (Indomaret, Alfamart, Alfamidi, Lawson, FamilyMart, Circle K) counted as a snack run, minor units. Default Rp 100.000"),
  targets: z
    .record(z.string(), z.number().min(0).nullable())
    .optional()
    .describe('Chosen target per habit key, instead of the suggestion: times per week or month (unit "week"/"month"), or a monthly cap in minor units (unit "cap"); null keeps that habit as it is (left out of the total and cutItems). E.g. {"food/coffee": 2, "minimarket": null}'),
  goalAmount: z.number().int().min(0).optional().describe("Optional goal for liquid money (all liquid accounts together), minor units: reports when it is reached with and without the cuts"),
  effect: z.boolean().default(true).describe("Simulate the cuts against the plan (no items, a saved scenarioId, or the items given)"),
});

/** The household's first full month: the month of its first transaction, or the next one if that started after the 7th. */
function firstFullMonth(firstDate: string | null): string | null {
  if (!firstDate) return null;
  const m = firstDate.slice(0, 7);
  return Number(firstDate.slice(8, 10)) > 7 ? addMonths(m, 1) : m;
}

export async function savings(db: Database, p: Principal, raw: z.infer<typeof savingsInput>) {
  const { categories: wanted, minimarketMax, targets, goalAmount, effect, ...planRaw } = raw;
  const { plan } = await resolveSimulateInput(db, p, planRaw);
  const b = await computeBaseline(db, p, { months: plan.baselineMonths });
  const cur = b.cur;
  const habitSlugs = wanted?.length ? [...new Set(wanted.map((s) => s.trim().toLowerCase()))] : [...DEFAULT_HABIT_SLUGS];
  const max = minimarketMax ?? DEFAULT_MINIMARKET_MAX;

  const scope = and(eq(t.householdId, p.householdId), eq(t.currency, cur));
  const text = sql<string>`lower(coalesce(${t.merchant}, ${t.description}))`;
  const byCategory: SQL[] = habitSlugs.flatMap((s) => [eq(c.slug, s), like(c.slug, `${s}/%`)]);
  const byMinimarket = and(gte(t.amount, -max), or(...MINIMARKET_LIKE.map((x) => like(text, `%${x}%`))));
  const [first, rows, cats] = await Promise.all([
    db.select({ date: sql<string | null>`min(${t.date})` }).from(t).where(scope),
    db
      .select({ id: t.id, date: t.date, amount: t.amount, merchant: t.merchant, description: t.description, slug: c.slug })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      // Expenses only: transfers and reimbursable rows (draft, submitted, paid) are not household spending (kindExpr).
      .where(and(scope, gte(t.date, b.from), lte(t.date, b.to), sql`${t.amount} < 0`, sql`${kindExpr} = 'expense'`, or(...byCategory, byMinimarket))),
    categoriesById(db, p.householdId),
  ]);

  const start = firstFullMonth(first[0]?.date ?? null);
  const months = start ? b.window.filter((m) => m >= start) : [];
  const names = new Map([...cats.values()].filter((x) => x.kind === "expense").map((x) => [x.slug, x.name]));
  const excludedIds = new Set(b.spending.excluded.filter((e) => e.kind === "expense").map((e) => e.id));
  const result = detectHabits({
    months,
    rows: rows.map((r) => ({ ...r, amount: -r.amount })),
    categories: names,
    habitSlugs,
    minimarketMax: max,
    monthlyIncome: b.recurringIncome,
    excludedIds,
    targets,
  });

  const m = (x: number) => money(x, cur);
  const rp = (x: number) => formatMoney(x, cur);
  const startMonth = startOf(plan);
  const cuts = cutItems(result.habits, rp, startMonth);
  let effectOut = null;
  if (effect) {
    const { base } = await simBaseline(db, p, plan, b);
    const e = cutEffect(base, plan.items, cuts, { startMonth, horizonMonths: plan.horizonMonths, rules: { ...DEFAULT_RULES, ...plan.rules } }, goalAmount);
    effectOut = {
      startMonth,
      horizonMonths: plan.horizonMonths,
      against: raw.scenarioId ? "saved scenario" : plan.items.some((i) => i.type !== "cut") ? "the plan's items" : "no change (today's income and spending)",
      monthlySaving: m(e.monthlySaving),
      milestones: e.milestones,
      verdict: e.verdict,
      rulesImproved: e.rulesImproved,
      endBalance: { without: m(e.endBalance.without), with: m(e.endBalance.with) },
    };
  }

  const habitOut = (h: Habit) => ({
    key: h.key,
    kind: h.kind,
    name: h.name,
    categories: h.slugs,
    count: h.count,
    perWeek: h.perWeek,
    perMonth: h.perMonth,
    averageTicket: m(h.averageTicket),
    monthly: m(h.monthly),
    incomeSharePct: h.incomeSharePct,
    trend: { ...h.trend, recent: m(h.trend.recent), earlier: m(h.trend.earlier) },
    byMonth: h.byMonth.map((x) => ({ month: x.month, count: x.count, ...m(x.amount) })),
    topMerchants: h.topMerchants.map((x) => ({ name: x.name, count: x.count, ...m(x.amount) })),
    suggestion: h.suggestion
      ? {
          unit: h.suggestion.unit,
          current: h.suggestion.current,
          target: h.suggestion.target,
          saving: m(h.suggestion.saving),
          options: h.suggestion.options.map((o) => ({ target: o.target, saving: m(o.saving), ...(h.suggestion!.unit === "cap" ? { display: rp(o.target) } : {}) })),
        }
      : null,
    included: h.included,
    reason: h.reason,
  });

  const notes = [
    "Only the household's own history and income are compared; there are no outside benchmarks.",
    "Transfers, top-ups, reimbursable expenses (until rejected) and the one-offs the plan baseline leaves out are not counted. Pending quick adds count, as in reports.",
    `Minimarket snacks: Indomaret, Alfamart, Alfamidi, Lawson, FamilyMart and Circle K baskets up to ${rp(max)}, in any category except the habit categories above (a row counts once).`,
    months.length < b.window.length && months.length ? `History starts in ${months[0]}; only ${months.length} complete month(s) are used.` : null,
    !months.length ? "No complete months of history yet." : null,
    result.missing.length ? `Not in this household's categories: ${result.missing.join(", ")}.` : null,
  ].filter((x): x is string => !!x);

  return {
    currency: cur,
    months: result.months,
    monthlyIncome: m(b.recurringIncome),
    minimarketMax: m(max),
    habits: result.habits.map(habitOut),
    totalSaving: m(result.totalSaving),
    totalSavingIncomePct: b.recurringIncome > 0 ? Math.round((result.totalSaving / b.recurringIncome) * 1000) / 10 : null,
    /** Scenario items for simulate_plan / compare_plans / save_scenario: one cut per habit, at the chosen or suggested target. */
    cutItems: cuts,
    effect: effectOut,
    missingCategories: result.missing,
    notes,
  };
}
