// Month-by-month projection of a scenario and the safety rules it is judged by. Pure and deterministic: integer minor
// units in, integer minor units out.
import { formatMoney } from "../money";
import { loanTerms, saleOutcome } from "./loan";
import type { LoanTerms, SaleOutcome } from "./loan";
import { addMonths, average, monthsBetween, wholeUnits } from "./months";
import { RESALE_ASSUMPTION } from "./resale";
import type { IncomeChangeItem, LoanItem, RecurringItem, Role, RuleOptions, ScenarioItem } from "./schema";

export type Buckets = Record<Role, number>;

export type SimBaseline = {
  currency: string;
  monthlyIncome: number;
  monthlySpending: number;
  /** Loan installments already being paid (recorded as transfers, so not in spending). */
  existingInstallments: number;
  balances: Buckets;
  /** Account id -> role, so fundedFrom can name an account. */
  accountRoles: Record<string, Role>;
};

export type SimOptions = { startMonth: string; horizonMonths: number; rules: RuleOptions };

export const DEFAULT_RULES: RuleOptions = { emergencyMonths: 6, maxDebtPct: 30, maxCarPct: 20 };

export type ProjectionMonth = {
  month: string;
  income: number;
  spending: number;
  recurring: number;
  installments: number;
  carInstallments: number;
  /** Fuel, parking, maintenance, insurance renewals and PKB, minus what the car saves. */
  vehicleCosts: number;
  /** Income minus the month's regular outflow. */
  freeCash: number;
  upfront: number;
  inflows: number;
  balances: Buckets;
  total: number;
  /** Regular outflow with yearly costs spread over 12 months: what the emergency fund has to cover. */
  outflowForCover: number;
  emergencyCoverMonths: number;
};

export type RuleStatus = "ok" | "warn" | "fail" | "info";
export type RuleResult = { id: "emergency" | "debt" | "car" | "balance" | "cashflow" | "goal"; title: string; status: RuleStatus; value: number | null; threshold: string; detail: string };
export type Verdict = "comfortable" | "tight" | "risky";

export type LoanSale = SaleOutcome & {
  month: string;
  /** What owning it cost until the sale: upfront, installments paid, running costs, renewals and tax, the settlement, minus the resale and what it saved. */
  costWhileOwned: number;
};

export type LoanSummary = { id: string | undefined; label: string; asset: string; month: string; terms: LoanTerms; sale: LoanSale | null };

/** Owned in month offset `off` (purchase month 0, sale month and after not). */
const owned = (l: LoanSummary, off: number) => off >= 0 && (!l.sale || off < l.sale.offset);

/** Whether an installment of `l` is due in month offset `off` (the advance first installment is part of the upfront). */
function installmentDue(l: LoanSummary, off: number): boolean {
  const [first, last] = l.terms.installmentOffsets;
  return l.terms.installment > 0 && off >= first && off <= last && !(off === 0 && first === 0) && owned(l, off);
}

function summarizeLoan(item: LoanItem, startMonth: string): LoanSummary {
  const terms = loanTerms(item);
  const month = item.month ?? startMonth;
  const base = { id: item.id, label: item.label, asset: item.asset, month, terms, sale: null };
  const out = saleOutcome(item, terms);
  if (!out) return base;
  const l: LoanSummary = { ...base, sale: { ...out, month: addMonths(month, out.offset), costWhileOwned: 0 } };
  let cost = terms.upfront - out.net;
  for (let off = 0; off < out.offset; off++) {
    if (installmentDue(l, off)) cost += terms.installment;
    cost += terms.runningMonthly - item.savesMonthly + (off > 0 && off % 12 === 0 ? terms.insuranceRenewalYearly + terms.annualTax : 0);
  }
  l.sale!.costWhileOwned = cost;
  return l;
}

/** The most new installments due in any one month, over the loans' whole schedules. */
function peakInstallment(loans: LoanSummary[], filter: (l: LoanSummary) => boolean): number {
  const chosen = loans.filter(filter);
  if (!chosen.length) return 0;
  const first = chosen.reduce((m, l) => (l.month < m ? l.month : m), chosen[0]!.month);
  const span = Math.max(...chosen.map((l) => monthsBetween(first, l.month) + l.terms.tenorMonths + 1));
  let peak = 0;
  for (let k = 0; k <= span; k++) {
    const month = addMonths(first, k);
    peak = Math.max(peak, chosen.reduce((s, l) => s + (installmentDue(l, monthsBetween(l.month, month)) ? l.terms.installment : 0), 0));
  }
  return peak;
}

export type SimResult = {
  startMonth: string;
  horizonMonths: number;
  loans: LoanSummary[];
  projection: ProjectionMonth[];
  rules: RuleResult[];
  verdict: Verdict;
  reasons: string[];
  summary: {
    installment: number;
    carInstallment: number;
    upfront: number;
    lowest: { total: number; month: string };
    end: number;
    emergencyCoverWorst: { months: number; month: string };
    debtRatioPct: number;
    carRatioPct: number;
    goalRebuiltInMonths: number | null;
    averageFreeCash: number;
  };
  assumptions: string[];
};

const ORDER: Role[] = ["spending", "goal", "emergency"];

function roleOf(ref: string, base: SimBaseline): Role {
  if (ref === "emergency" || ref === "goal" || ref === "spending") return ref;
  return base.accountRoles[ref] ?? "spending";
}

/** Takes `amount` from `first`, then spending, goal, emergency; what nobody can cover leaves spending negative. Returns what came out of emergency. */
export function draw(b: Buckets, first: Role, amount: number): number {
  let left = amount;
  let fromEmergency = 0;
  for (const r of [first, ...ORDER.filter((x) => x !== first)]) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, b[r]));
    b[r] -= take;
    left -= take;
    if (r === "emergency") fromEmergency += take;
  }
  if (left > 0) b.spending -= left;
  return fromEmergency;
}

/** A surplus fills the emergency fund, then the goal pocket, up to their targets; the rest stays in spending. */
export function deposit(b: Buckets, amount: number, targets: Buckets) {
  let left = amount;
  if (b.spending < 0) {
    const fix = Math.min(left, -b.spending);
    b.spending += fix;
    left -= fix;
  }
  for (const r of ["emergency", "goal"] as const) {
    const gap = Math.max(0, targets[r] - b[r]);
    const put = Math.min(gap, left);
    b[r] += put;
    left -= put;
  }
  b.spending += left;
}

export function recurringAmount(item: RecurringItem, offset: number): number {
  const ramp =
    item.rampTo !== undefined && item.rampMonths ? item.monthly + ((item.rampTo - item.monthly) * Math.min(offset, item.rampMonths)) / item.rampMonths : item.monthly;
  return wholeUnits(ramp * (1 + item.annualIncreasePct / 100) ** Math.floor(offset / 12));
}

function recurringEnd(item: RecurringItem, start: string): string | null {
  if (item.endMonth) return item.endMonth;
  if (item.months) return addMonths(start, item.months - 1);
  return null;
}

export function incomeFor(base: number, changes: IncomeChangeItem[], month: string, start: string): number {
  const active = changes.filter((c) => (c.startMonth ?? start) <= month && (!c.endMonth || month <= c.endMonth));
  let income = base;
  for (const c of active) if (c.mode === "replace") income = c.amount;
  for (const c of active) if (c.mode === "delta") income += c.amount;
  return income;
}

const pct1 = (x: number) => Math.round(x * 1000) / 10;
const months1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 999);

export function simulate(base: SimBaseline, items: ScenarioItem[], opts: SimOptions): SimResult {
  const { startMonth, horizonMonths: n, rules } = opts;
  const money = (x: number) => formatMoney(x, base.currency);
  const loans: LoanSummary[] = items.filter((i): i is LoanItem => i.type === "loan").map((i) => summarizeLoan(i, startMonth));
  const recurring = items.filter((i): i is RecurringItem => i.type === "recurring");
  const incomeChanges = items.filter((i): i is IncomeChangeItem => i.type === "incomeChange");
  const oneOffs = items.filter((i) => i.type === "oneOff");
  const loanItems = items.filter((i): i is LoanItem => i.type === "loan");

  const b: Buckets = { ...base.balances };
  const targets: Buckets = { ...base.balances, spending: 0 };
  const projection: ProjectionMonth[] = [];
  let emergencyForDeficit = 0;
  let emergencyForUpfront = 0;

  for (let k = 0; k < n; k++) {
    const month = addMonths(startMonth, k);
    const income = incomeFor(base.monthlyIncome, incomeChanges, month, startMonth);
    let rec = 0;
    for (const r of recurring) {
      const s = r.startMonth ?? startMonth;
      const end = recurringEnd(r, s);
      if (month < s || (end && month > end)) continue;
      rec += recurringAmount(r, monthsBetween(s, month));
    }
    let installments = base.existingInstallments;
    let carInstallments = 0;
    let vehicle = 0;
    let vehicleYearlySpread = 0;
    let upfront = 0;
    let upfrontFromEmergency = 0;
    let sales = 0;
    loans.forEach((l, idx) => {
      const item = loanItems[idx]!;
      const off = monthsBetween(l.month, month);
      const t = l.terms;
      if (installmentDue(l, off)) {
        installments += t.installment;
        if (l.asset === "car") carInstallments += t.installment;
      }
      if (owned(l, off)) {
        // Installments in advance: the first is part of the upfront payment, so it is not counted twice.
        const yearly = t.insuranceRenewalYearly + t.annualTax;
        vehicle += t.runningMonthly - item.savesMonthly + (off > 0 && off % 12 === 0 ? yearly : 0);
        vehicleYearlySpread += t.runningMonthly - item.savesMonthly + yearly / 12;
      }
      if (off === 0) {
        upfront += t.upfront;
        upfrontFromEmergency += draw(b, roleOf(item.fundedFrom, base), t.upfront);
      }
      // Sold: the proceeds settle the loan first; what is left comes in, a shortfall is paid like an upfront cost.
      if (l.sale && off === l.sale.offset) {
        const to = roleOf(item.sale!.proceedsTo, base);
        if (l.sale.net >= 0) {
          b[to] += l.sale.net;
          sales += l.sale.net;
        } else {
          upfront += -l.sale.net;
          upfrontFromEmergency += draw(b, to, -l.sale.net);
        }
      }
    });
    let inflows = sales;
    for (const o of oneOffs) {
      if ((o.month ?? startMonth) !== month) continue;
      if (o.direction === "in") {
        b[roleOf(o.fundedFrom, base)] += o.amount;
        inflows += o.amount;
      } else {
        upfront += o.amount;
        upfrontFromEmergency += draw(b, roleOf(o.fundedFrom, base), o.amount);
      }
    }
    emergencyForUpfront += upfrontFromEmergency;

    const outflow = base.monthlySpending + rec + installments + vehicle;
    const freeCash = income - outflow;
    const outflowForCover = base.monthlySpending + rec + installments + wholeUnits(vehicleYearlySpread);
    // The emergency fund is topped up to the larger of where it started and the months of outflow it should cover.
    targets.emergency = Math.max(base.balances.emergency, wholeUnits(rules.emergencyMonths * outflowForCover));
    if (freeCash >= 0) deposit(b, freeCash, targets);
    else emergencyForDeficit += draw(b, "spending", -freeCash);

    projection.push({
      month,
      income,
      spending: base.monthlySpending,
      recurring: rec,
      installments,
      carInstallments,
      vehicleCosts: vehicle,
      freeCash,
      upfront,
      inflows,
      balances: { ...b },
      total: b.emergency + b.goal + b.spending,
      outflowForCover,
      emergencyCoverMonths: outflowForCover > 0 ? months1(b.emergency / outflowForCover) : 999,
    });
  }

  // Rules.
  const results: RuleResult[] = [];
  const worstCover = projection.reduce((w, p) => (p.emergencyCoverMonths < w.emergencyCoverMonths ? p : w), projection[0]!);
  const worstAll = projection.reduce((w, p) => Math.min(w, p.outflowForCover > 0 ? p.total / p.outflowForCover : 999), 999);
  const target = rules.emergencyMonths;
  results.push({
    id: "emergency",
    title: `Emergency fund covers ${target} months of outflow`,
    status: worstCover.emergencyCoverMonths >= target ? "ok" : worstCover.emergencyCoverMonths >= target / 2 ? "warn" : "fail",
    value: worstCover.emergencyCoverMonths,
    threshold: `≥ ${target} months`,
    detail:
      `At its lowest (${worstCover.month}) the emergency fund of ${money(worstCover.balances.emergency)} covers ${worstCover.emergencyCoverMonths} months of the new monthly outflow of ${money(worstCover.outflowForCover)}` +
      ` (target ${target}). All liquid money together covers ${months1(worstAll)} months at its lowest.` +
      (emergencyForUpfront > 0 ? ` ${money(emergencyForUpfront)} of the upfront costs had to come from the emergency fund.` : "") +
      (emergencyForDeficit > 0 ? ` Monthly shortfalls take ${money(emergencyForDeficit)} from it.` : ""),
  });

  const ratio = (p: ProjectionMonth, x: number) => (p.income > 0 ? x / p.income : x > 0 ? Infinity : 0);
  const worstDebt = projection.reduce((w, p) => (ratio(p, p.installments) > ratio(w, w.installments) ? p : w), projection[0]!);
  const debtPct = pct1(ratio(worstDebt, worstDebt.installments));
  const grade = (v: number, max: number): RuleStatus => (v <= max ? "ok" : v <= max + 10 ? "warn" : "fail");
  results.push({
    id: "debt",
    title: `All installments ≤ ${rules.maxDebtPct}% of income`,
    status: grade(debtPct, rules.maxDebtPct),
    value: Number.isFinite(debtPct) ? debtPct : null,
    threshold: `≤ ${rules.maxDebtPct}%`,
    detail: worstDebt.installments
      ? `Installments of ${money(worstDebt.installments)} are ${Number.isFinite(debtPct) ? `${debtPct}%` : "all"} of ${money(worstDebt.income)} income (${worstDebt.month}).`
      : "No installments.",
  });
  if (loans.some((l) => l.asset === "car")) {
    const worstCar = projection.reduce((w, p) => (ratio(p, p.carInstallments) > ratio(w, w.carInstallments) ? p : w), projection[0]!);
    const carPct = pct1(ratio(worstCar, worstCar.carInstallments));
    results.push({
      id: "car",
      title: `Car installment ≤ ${rules.maxCarPct}% of income`,
      status: grade(carPct, rules.maxCarPct),
      value: Number.isFinite(carPct) ? carPct : null,
      threshold: `≤ ${rules.maxCarPct}%`,
      detail: `The car installment of ${money(worstCar.carInstallments)} is ${Number.isFinite(carPct) ? `${carPct}%` : "all"} of ${money(worstCar.income)} income (${worstCar.month}).`,
    });
  }

  const lowest = projection.reduce((w, p) => (p.total < w.total ? p : w), projection[0]!);
  const firstNegative = projection.find((p) => p.total < 0);
  results.push({
    id: "balance",
    title: "Liquid money never runs out",
    status: firstNegative ? "fail" : "ok",
    value: lowest.total,
    threshold: "≥ Rp 0 every month",
    detail: firstNegative
      ? `Liquid money runs out in ${firstNegative.month} and is lowest at ${money(lowest.total)} in ${lowest.month}.`
      : `Lowest liquid balance: ${money(lowest.total)} in ${lowest.month}.`,
  });

  const negative = projection.filter((p) => p.freeCash < 0);
  const avgFree = average(projection.map((p) => p.freeCash));
  const last = projection[projection.length - 1]!;
  results.push({
    id: "cashflow",
    title: "Income covers the monthly outflow",
    status: !negative.length ? "ok" : last.freeCash < 0 ? "fail" : "warn",
    value: avgFree,
    threshold: "free cash ≥ Rp 0",
    detail: !negative.length
      ? `Every month ends with money left over: ${money(Math.min(...projection.map((p) => p.freeCash)))} at the least, ${money(avgFree)} on average.`
      : last.freeCash < 0
        ? `The monthly outflow is higher than income and stays that way: ${money(last.freeCash)} a month at the end of the plan. Savings shrink every month.`
        : `${negative.length} of ${n} months spend more than comes in (worst ${money(Math.min(...negative.map((p) => p.freeCash)))}); savings cover the gap.`,
  });

  let goalRebuilt: number | null = null;
  const goalStart = base.balances.goal;
  const firstDrop = projection.findIndex((p) => p.balances.goal < goalStart);
  if (goalStart > 0 || firstDrop >= 0) {
    const back = firstDrop >= 0 ? projection.findIndex((p, i) => i > firstDrop && p.balances.goal >= goalStart) : -1;
    goalRebuilt = firstDrop < 0 ? 0 : back >= 0 ? back - firstDrop + 1 : null;
    results.push({
      id: "goal",
      title: "Goal savings rebuilt",
      status: "info",
      value: goalRebuilt,
      threshold: "informational",
      detail:
        firstDrop < 0
          ? "The goal savings are not touched."
          : goalRebuilt !== null
            ? `The goal savings (${money(goalStart)}) are used in ${projection[firstDrop]!.month} and back to that level after ${goalRebuilt} months (${projection[back]!.month}).`
            : `The goal savings (${money(goalStart)}) are used in ${projection[firstDrop]!.month} and not back to that level within ${n} months.`,
    });
  }

  const fails = results.filter((r) => r.status === "fail");
  const warns = results.filter((r) => r.status === "warn");
  const verdict: Verdict = fails.length ? "risky" : warns.length ? "tight" : "comfortable";
  const reasons = (fails.length || warns.length ? [...fails, ...warns] : results.filter((r) => r.status === "ok")).map((r) => r.detail);

  const carLoans = loans.filter((l) => l.asset === "car");
  const assumptions = [
    `Income ${money(base.monthlyIncome)} and core spending ${money(base.monthlySpending)} a month stay at today's level (no raises, no inflation) unless the scenario changes them.`,
    base.existingInstallments ? `Existing installments of ${money(base.existingInstallments)} a month continue for the whole plan.` : "No existing installments (loan payments recorded as transfers are not in spending; add them if there are any).",
    `Starting balances: emergency ${money(base.balances.emergency)}, goal ${money(base.balances.goal)}, spending ${money(base.balances.spending)}.`,
    "Upfront costs come from the account they are funded from, then spending, then goal savings, and the emergency fund last.",
    `Money left over each month first tops up the emergency fund (to ${rules.emergencyMonths} months of outflow, or its starting balance if higher), then restores the goal savings to their starting level; the rest stays in spending accounts. Nothing is invested or earns interest.`,
    ...(carLoans.length ? ["Running costs start in the purchase month; insurance renewal and PKB are paid every 12 months after it (the first year's PKB is in the OTR price)."] : []),
    ...(loans.some((l) => l.sale)
      ? [
          "A car that is sold stops costing anything from its sale month: no installment, running costs, insurance or PKB. The sale price first settles the loan's outstanding principal (on the declining-balance schedule at the loan's effective rate, plus any early-settlement penalty entered); the rest is paid in that month.",
          ...(loans.some((l) => l.sale?.resaleEstimated) ? [RESALE_ASSUMPTION] : []),
        ]
      : []),
    "Rates, prices and costs are the ones entered here; confirm them with the dealer, lender and hospital. This is an estimate, not financial advice.",
  ];

  return {
    startMonth,
    horizonMonths: n,
    loans,
    projection,
    rules: results,
    verdict,
    reasons,
    summary: {
      installment: peakInstallment(loans, () => true),
      carInstallment: peakInstallment(loans, (l) => l.asset === "car"),
      upfront: projection.reduce((s, p) => s + p.upfront, 0),
      lowest: { total: lowest.total, month: lowest.month },
      end: last.total,
      emergencyCoverWorst: { months: worstCover.emergencyCoverMonths, month: worstCover.month },
      debtRatioPct: Number.isFinite(debtPct) ? debtPct : 100,
      carRatioPct: results.find((r) => r.id === "car")?.value ?? 0,
      goalRebuiltInMonths: goalRebuilt,
      averageFreeCash: avgFree,
    },
    assumptions,
  };
}
