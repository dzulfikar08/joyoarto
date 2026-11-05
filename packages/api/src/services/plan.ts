import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { DEFAULT_BASELINE_OPTIONS, existingInstallments, incomeSources, roleTotals, spendingBaseline, suggestRole } from "../lib/plan/baseline";
import type { LoanTerms } from "../lib/plan/loan";
import { addMonths, average, completeMonthsBefore, median } from "../lib/plan/months";
import { ACCOUNT_ROLES, compareInput, planInput, planOverrides, scenarioItem, simulateInput } from "../lib/plan/schema";
import type { AccountRole, Role } from "../lib/plan/schema";
import { DEFAULT_RULES, simulate } from "../lib/plan/simulate";
import type { LoanSale, SimBaseline, SimResult } from "../lib/plan/simulate";
import { templates as buildTemplates } from "../lib/plan/templates";
import { listAccounts } from "./accounts";
import { scenariosByIds } from "./scenarios";
import { baseCurrency, categoriesById, money, month } from "./common";
import { currentMonth, kindExpr, ownMoney, topSlug } from "./reports";

const t = schema.transaction;
const c = schema.category;

export const baselineInput = z.object({
  months: z.number().int().min(3).max(24).default(6).describe("Complete months of history to use (default 6, before this month)"),
  outlierMin: z.number().int().min(0).optional().describe("Smallest single expense treated as a one-off, minor units (default Rp 2.000.000)"),
  outlierSharePct: z.number().min(0).max(100).optional().describe("A one-off is also above this % of its month's spending (default 25)"),
});

function monthEnd(m: string) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

/** Raw baseline in minor units: what the simulator starts from. */
export async function computeBaseline(db: Database, p: Principal, input: z.infer<typeof baselineInput>) {
  const cur = await baseCurrency(db, p.householdId);
  const window = completeMonthsBefore(currentMonth(), input.months);
  const from = `${window[0]}-01`;
  const to = monthEnd(window[window.length - 1]!);
  const opts = {
    outlierMin: input.outlierMin ?? DEFAULT_BASELINE_OPTIONS.outlierMin,
    outlierShare: input.outlierSharePct !== undefined ? input.outlierSharePct / 100 : DEFAULT_BASELINE_OPTIONS.outlierShare,
  };
  const scope = (fromDay: string) => and(eq(t.householdId, p.householdId), eq(t.currency, cur), gte(t.date, fromDay), lte(t.date, to));
  const mo = sql<string>`substr(${t.date}, 1, 7)`;

  const [incomeRows, byCategory, large, inflows, transfers, accounts, cats] = await Promise.all([
    // A month earlier too: a salary paid at the end of it may be for the first month of the window.
    db
      .select({ date: t.date, amount: t.amount, slug: c.slug })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(scope(`${addMonths(window[0]!, -1)}-01`), sql`${kindExpr} = 'income'`)),
    db
      .select({ month: mo, slug: topSlug, total: sql<number>`sum(${t.amount})`, out: sql<number>`sum(case when ${t.amount} < 0 then ${t.amount} else 0 end)` })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(scope(from), sql`${kindExpr} = 'expense'`))
      .groupBy(mo, topSlug),
    db
      .select({ id: t.id, date: t.date, amount: t.amount, description: sql<string>`coalesce(${t.merchant}, ${t.description})`, slug: topSlug })
      .from(t)
      .leftJoin(c, eq(c.id, t.categoryId))
      .where(and(scope(from), sql`${kindExpr} = 'expense'`, lte(t.amount, -Math.max(1, opts.outlierMin))))
      // Largest outflow first, so the capped list keeps the real one-offs.
      .orderBy(asc(t.amount), asc(t.date))
      .limit(500),
    // Money back into expense categories big enough to offset a one-off (refunds, someone else's share).
    db
      .select({ id: t.id, date: t.date, amount: t.amount, description: sql<string>`coalesce(${t.merchant}, ${t.description})`, slug: topSlug })
      .from(t)
      .innerJoin(c, eq(c.id, t.categoryId))
      .where(and(scope(from), ownMoney, eq(c.kind, "expense"), gte(t.amount, Math.max(1, Math.ceil(opts.outlierMin / 2)))))
      .orderBy(desc(t.amount), asc(t.date))
      .limit(500),
    db
      .select({
        slug: c.slug,
        name: c.name,
        month: mo,
        out: sql<number>`sum(case when ${t.amount} < 0 then -${t.amount} else 0 end)`,
        in: sql<number>`sum(case when ${t.amount} > 0 then ${t.amount} else 0 end)`,
      })
      .from(t)
      .innerJoin(c, eq(c.id, t.categoryId))
      .where(and(scope(from), ownMoney, eq(c.kind, "transfer")))
      .groupBy(c.slug, c.name, mo),
    listAccounts(db, p),
    categoriesById(db, p.householdId),
  ]);

  const names = new Map([...cats.values()].map((x) => [x.slug, x.name]));
  const income = incomeSources(window, incomeRows, names);
  const spending = spendingBaseline(
    window,
    byCategory.map((r) => ({ month: r.month, slug: r.slug, total: -Number(r.total), out: -Number(r.out) })),
    large.map((r) => ({ ...r, amount: -r.amount })),
    names,
    opts,
    inflows,
  );
  const installments = existingInstallments(
    window,
    transfers.map((r) => ({ slug: r.slug, name: r.name, month: r.month, out: Number(r.out), in: Number(r.in) })),
  );
  const accountRows = accounts.accounts
    .filter((a) => !a.archived && a.currency === cur)
    .map((a) => {
      const s = suggestRole(a);
      return { id: a.id, name: a.name, institution: a.institution, type: a.type, balance: a.balance.amount, lastDate: a.lastDate, suggestedRole: s.role, reason: s.reason };
    });
  const recurringIncome = income.sources.reduce((s, x) => s + x.recurring, 0);
  const totalsByMonth = window.map((m) => income.sources.reduce((s, x) => s + (x.byMonth.find((b) => b.month === m)?.amount ?? 0), 0));
  return { cur, window, from, to, opts, income, spending, installments, accountRows, recurringIncome, totalsByMonth };
}

export async function baseline(db: Database, p: Principal, input: z.infer<typeof baselineInput>) {
  const b = await computeBaseline(db, p, input);
  const m = (x: number) => money(x, b.cur);
  const existing = b.installments.monthly;
  const oneOffs = b.spending.excluded.filter((e) => e.kind === "expense").length;
  const offsets = b.spending.excluded.filter((e) => e.kind === "refund").length;
  const balances = roleTotals(b.accountRows.map((a) => ({ role: a.suggestedRole, balance: a.balance })));
  const notes = [
    "Income and spending exclude transfers (own accounts, top-ups, card payments, loans).",
    b.income.salary.note,
    oneOffs
      ? `${oneOffs} large one-off expense(s) are left out of core spending; add them back if they recur (school fees, yearly insurance).`
      : null,
    offsets ? `${offsets} large refund(s) or reimbursement(s) into expense categories are left out with them, so they do not lower core spending.` : null,
    b.income.sources.some((s) => s.irregular) ? "Irregular income (gifts, refunds, other, or present in under half the months) is not counted as recurring." : null,
    b.accountRows.some((a) => a.lastDate && a.lastDate < b.from) ? "Some account balances have no recent transactions; import their latest statements for current balances." : null,
  ].filter((x): x is string => !!x);
  return {
    currency: b.cur,
    months: b.window,
    from: b.from,
    to: b.to,
    income: {
      recurring: m(b.recurringIncome),
      average: m(average(b.totalsByMonth)),
      median: m(median(b.totalsByMonth)),
      sources: b.income.sources.map((s) => ({
        slug: s.slug,
        name: s.name,
        monthsPresent: s.monthsPresent,
        average: m(s.average),
        median: m(s.median),
        recurring: m(s.recurring),
        irregular: s.irregular,
        reason: s.reason,
        byMonth: s.byMonth.map((x) => ({ month: x.month, ...m(x.amount) })),
      })),
      salaryMonths: {
        shiftDetected: b.income.salary.shiftDetected,
        median: m(b.income.salary.median),
        average: m(b.income.salary.average),
        months: b.income.salary.months.map((x) => ({ month: x.month, ...m(x.amount), paidOn: x.paidOn })),
        calendarGaps: b.income.salary.calendarGaps,
        calendarDoubles: b.income.salary.calendarDoubles,
      },
    },
    spending: {
      monthly: m(b.spending.monthly),
      average: m(b.spending.average),
      median: m(b.spending.median),
      coreAverage: m(b.spending.coreAverage),
      coreMedian: m(b.spending.coreMedian),
      outlierRule: `A single expense above the larger of ${money(b.opts.outlierMin, b.cur).display} and ${Math.round(b.opts.outlierShare * 100)}% of its month's spending`,
      byMonth: b.spending.byMonth.map((x) => ({ month: x.month, total: m(x.total), excluded: m(x.excluded), core: m(x.core), outliers: m(x.outliers), refunds: m(x.refunds) })),
      /** One-off expenses (positive) and the refunds taken out with them (negative: money back). */
      excluded: b.spending.excluded.map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.slug,
        ...m(e.amount),
        threshold: m(e.threshold),
        kind: e.kind,
        pairedWith: e.pairedWith,
      })),
      categories: b.spending.categories.map((x) => ({ slug: x.slug, name: x.name, average: m(x.average), coreAverage: m(x.coreAverage) })),
    },
    existingInstallments: {
      monthly: m(existing),
      categories: b.installments.categories.map((x) => ({ slug: x.slug, name: x.name, monthly: m(x.monthly), months: x.months, netPaid: m(x.netPaid) })),
      skipped: b.installments.skipped,
      note: "Loan repayments are transfers, so they are not in spending. Counted: transfer categories for the household's own debt (cicilan, KPR, angsuran, kredit, paylater, leasing…) paid in at least half the months, net of money paid back; money lent to others and card-bill payments are not. Add any others in the plan.",
    },
    accounts: b.accountRows.map((a) => ({ ...a, balance: m(a.balance) })),
    balances: { emergency: m(balances.emergency), goal: m(balances.goal), spending: m(balances.spending), total: m(balances.emergency + balances.goal + balances.spending) },
    freeCash: m(b.recurringIncome - b.spending.monthly - existing),
    notes,
  };
}

export const simulatePlanInput = planOverrides.extend({
  scenarioId: z.string().max(64).optional().describe("Simulate a saved scenario (list_scenarios). Fields given here override its own; items, when given, replace its items."),
});

export const comparePlanInput = compareInput.extend({
  scenarios: z
    .array(
      z
        .object({
          name: z.string().min(1).max(60).optional().describe("Required for an inline scenario; default for a saved one: its saved name"),
          items: z.array(scenarioItem).max(30).optional(),
          scenarioId: z.string().max(64).optional().describe("A saved scenario: its items are used (against this call's baseline)"),
        })
        .refine((x) => x.scenarioId !== undefined || x.name !== undefined, { message: "Give a name (and items) or a scenarioId", path: ["name"] }),
    )
    .min(1)
    .max(6),
});

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The plan to simulate: a saved scenario's, with whatever the call names on top. */
export async function resolveSimulateInput(db: Database, p: Principal, input: z.infer<typeof simulatePlanInput>) {
  const { scenarioId, ...overrides } = input;
  const saved = scenarioId ? (await scenariosByIds(db, p, [scenarioId]))[0]! : null;
  return { plan: simulateInput.parse({ ...saved?.plan, ...defined(overrides) }), saved };
}

const OVERRIDE_KEYS = ["monthlyIncome", "monthlySpending", "existingInstallments", "roles", "balances", "startingBalances", "startMonth", "horizonMonths", "baselineMonths", "rules"] as const;

export async function simBaseline(
  db: Database,
  p: Principal,
  input: z.infer<typeof planInput>,
  computed?: Awaited<ReturnType<typeof computeBaseline>>,
): Promise<{ base: SimBaseline; accounts: { id: string; name: string; role: AccountRole; balance: number }[] }> {
  const b = computed ?? (await computeBaseline(db, p, { months: input.baselineMonths }));
  const accounts = b.accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    role: input.roles?.[a.id] ?? a.suggestedRole,
    balance: input.balances?.[a.id] ?? a.balance,
  }));
  const totals = { ...roleTotals(accounts), ...Object.fromEntries(Object.entries(input.startingBalances ?? {}).filter(([, v]) => v !== undefined)) } as Record<Role, number>;
  const accountRoles: Record<string, Role> = {};
  for (const a of accounts) accountRoles[a.id] = a.role === "exclude" ? "spending" : a.role;
  return {
    base: {
      currency: b.cur,
      monthlyIncome: input.monthlyIncome ?? b.recurringIncome,
      monthlySpending: input.monthlySpending ?? b.spending.monthly,
      existingInstallments: input.existingInstallments ?? b.installments.monthly,
      balances: totals,
      accountRoles,
    },
    accounts,
  };
}

function loanOut(terms: LoanTerms, cur: string) {
  const m = (x: number) => money(x, cur);
  return {
    price: m(terms.price),
    downPayment: m(terms.downPayment),
    downPaymentPct: terms.downPaymentPct,
    principal: m(terms.principal),
    installment: m(terms.installment),
    tenorMonths: terms.tenorMonths,
    totalInstallments: m(terms.totalInstallments),
    totalInterest: m(terms.totalInterest),
    effectiveRatePct: terms.effectiveRatePct,
    insuranceFirstYear: m(terms.insuranceFirstYear),
    insuranceRenewalYearly: m(terms.insuranceRenewalYearly),
    adminFee: m(terms.adminFee),
    provisionFee: m(terms.provisionFee),
    upfront: m(terms.upfront),
    runningMonthly: m(terms.runningMonthly),
    annualTax: m(terms.annualTax),
    totalCostOfOwnership: m(terms.totalCostOfOwnership),
  };
}

function saleOut(sale: LoanSale | null, cur: string) {
  if (!sale) return null;
  const m = (x: number) => money(x, cur);
  return {
    month: sale.month,
    afterMonths: sale.offset,
    resale: m(sale.resale),
    resalePct: sale.resalePct,
    resaleEstimated: sale.resaleEstimated,
    installmentsPaid: sale.installmentsPaid,
    outstanding: m(sale.outstanding),
    penalty: m(sale.penalty),
    settlement: m(sale.settlement),
    net: m(sale.net),
    costWhileOwned: m(sale.costWhileOwned),
  };
}

function summaryOut(r: SimResult, cur: string) {
  const m = (x: number) => money(x, cur);
  const s = r.summary;
  return {
    installment: m(s.installment),
    carInstallment: m(s.carInstallment),
    upfront: m(s.upfront),
    lowestBalance: { ...m(s.lowest.total), month: s.lowest.month },
    endBalance: m(s.end),
    emergencyCoverMonths: s.emergencyCoverWorst.months,
    emergencyCoverWorstMonth: s.emergencyCoverWorst.month,
    debtRatioPct: s.debtRatioPct,
    carRatioPct: s.carRatioPct,
    goalRebuiltInMonths: s.goalRebuiltInMonths,
    averageFreeCash: m(s.averageFreeCash),
  };
}

function baseOut(base: SimBaseline, accounts: { id: string; name: string; role: AccountRole; balance: number }[]) {
  const m = (x: number) => money(x, base.currency);
  return {
    monthlyIncome: m(base.monthlyIncome),
    monthlySpending: m(base.monthlySpending),
    existingInstallments: m(base.existingInstallments),
    balances: { emergency: m(base.balances.emergency), goal: m(base.balances.goal), spending: m(base.balances.spending) },
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, role: a.role, ...m(a.balance) })),
  };
}

export function startOf(input: { startMonth?: string }) {
  return input.startMonth ?? addMonths(currentMonth(), 1);
}

export async function simulatePlan(db: Database, p: Principal, raw: z.infer<typeof simulatePlanInput>) {
  const { plan: input, saved } = await resolveSimulateInput(db, p, raw);
  const { base, accounts } = await simBaseline(db, p, input);
  const r = simulate(base, input.items, { startMonth: startOf(input), horizonMonths: input.horizonMonths, rules: { ...DEFAULT_RULES, ...input.rules } });
  const f = (x: number) => money(x, base.currency).display;
  return {
    currency: base.currency,
    startMonth: r.startMonth,
    horizonMonths: r.horizonMonths,
    baseline: baseOut(base, accounts),
    verdict: r.verdict,
    reasons: r.reasons,
    rules: r.rules,
    summary: summaryOut(r, base.currency),
    ...(saved ? { scenario: { id: saved.id, name: saved.name } } : {}),
    loans: r.loans.map((l) => ({ id: l.id, label: l.label, asset: l.asset, month: l.month, ...loanOut(l.terms, base.currency), sale: saleOut(l.sale, base.currency) })),
    projection: r.projection.map((x) => ({
      ...x,
      display: { income: f(x.income), freeCash: f(x.freeCash), upfront: f(x.upfront), total: f(x.total), emergency: f(x.balances.emergency) },
    })),
    assumptions: r.assumptions,
  };
}

export async function comparePlans(db: Database, p: Principal, input: z.infer<typeof comparePlanInput>) {
  const { base, accounts } = await simBaseline(db, p, input);
  const startMonth = startOf(input);
  const refs = input.scenarios.filter((s) => s.scenarioId).map((s) => s.scenarioId!);
  const saved = new Map((refs.length ? await scenariosByIds(db, p, refs) : []).map((x) => [x.id, x]));
  const notes: string[] = [];
  const scenarios = input.scenarios.map((s) => {
    const ref = s.scenarioId ? saved.get(s.scenarioId)! : null;
    if (ref) {
      const own = OVERRIDE_KEYS.filter((k) => ref.plan[k] !== undefined && !(k === "horizonMonths" && ref.plan[k] === 36) && !(k === "baselineMonths" && ref.plan[k] === 6) && !(k === "roles" && !Object.keys(ref.plan.roles ?? {}).length));
      if (own.length) notes.push(`Saved scenario "${ref.name}" has its own ${own.join(", ")}; compare uses this call's baseline for every scenario (simulate_plan with its scenarioId uses its own).`);
    }
    return { name: s.name ?? ref?.name ?? "Untitled", items: s.items ?? ref?.plan.items ?? [] };
  });
  if (input.includeBaseline && !scenarios.some((s) => !s.items.length)) scenarios.unshift({ name: "No change", items: [] });
  const opts = { startMonth, horizonMonths: input.horizonMonths, rules: { ...DEFAULT_RULES, ...input.rules } };
  const results = scenarios.map((s) => ({ name: s.name, r: simulate(base, s.items, opts) }));
  return {
    currency: base.currency,
    startMonth,
    horizonMonths: input.horizonMonths,
    months: results[0]!.r.projection.map((x) => x.month),
    baseline: baseOut(base, accounts),
    scenarios: results.map(({ name, r }) => ({
      name,
      verdict: r.verdict,
      reasons: r.reasons,
      summary: summaryOut(r, base.currency),
      rules: r.rules.map((x) => ({ id: x.id, title: x.title, status: x.status, value: x.value, detail: x.detail })),
      loans: r.loans.map((l) => ({ label: l.label, month: l.month, ...loanOut(l.terms, base.currency), sale: saleOut(l.sale, base.currency) })),
      /** Total liquid money and the emergency fund at the end of each month, minor units. */
      series: { total: r.projection.map((x) => x.total), emergency: r.projection.map((x) => x.balances.emergency), freeCash: r.projection.map((x) => x.freeCash) },
    })),
    assumptions: [...new Set(results.flatMap(({ r }) => r.assumptions))],
    notes,
  };
}

export const templatesInput = z.object({
  month: month.optional().describe("Purchase month for the car; default next month"),
  birthMonth: month.optional().describe("Expected birth month; default six months after month"),
  carPrice: z.number().int().min(0).optional().describe("OTR price in minor units"),
  sellAfterMonths: z.number().int().min(1).max(120).optional().describe("Upgrade template: months before the small car is sold (default 18)"),
});

export function planTemplates(input: z.infer<typeof templatesInput>) {
  const m = input.month ?? addMonths(currentMonth(), 1);
  return { templates: buildTemplates({ month: m, birthMonth: input.birthMonth, carPrice: input.carPrice, sellAfterMonths: input.sellAfterMonths }), roles: ACCOUNT_ROLES };
}
