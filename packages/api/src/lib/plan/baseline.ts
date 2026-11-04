// The planner's starting point, computed from the ledger: recurring income, core spending, liquid balances by role.
// Pure: the service fetches rows, this decides what is regular and what is a one-off.
import type { AccountRole } from "./schema";
import { addMonths, average, median, wholeUnits } from "./months";

export type IncomeTx = { date: string; amount: number; slug: string | null };
/** Net spending of a top-level category in a month (positive = spent). `out` is the gross spent, before money that came back. */
export type CategoryMonth = { month: string; slug: string | null; total: number; out?: number };
export type LargeExpense = { id: string; date: string; amount: number; description: string; slug: string | null };
/** Money that came back into an expense category (refund, someone else's share), positive minor units. */
export type ExpenseInflow = LargeExpense;
export type PlanAccount = { id: string; name: string; institution: string; type: string; currency: string; balance: number };

export type BaselineOptions = {
  /** Smallest single expense that can be a one-off (minor units). Default Rp 2.000.000. */
  outlierMin: number;
  /** A one-off is also larger than this share of its month's spending. Default 25%. */
  outlierShare: number;
};

export const DEFAULT_BASELINE_OPTIONS: BaselineOptions = { outlierMin: 200_000_000, outlierShare: 0.25 };

/** Income categories that are not a plan's income even when they recur. */
const IRREGULAR_SLUGS = new Set(["income/other", "income/gift", "income/refund"]);
const SALARY = /^income\/salary(\/|$)/;
/** A salary paid on or after this day of the month may be for the next month. */
const LATE_PAYDAY = 25;

export type IncomeSource = {
  slug: string | null;
  name: string;
  byMonth: { month: string; amount: number }[];
  monthsPresent: number;
  average: number;
  median: number;
  irregular: boolean;
  reason: string | null;
  /** What counts toward recurring income: 0 when irregular. */
  recurring: number;
};

export type SalaryMonths = {
  /** Paid late in a month for the next one, so calendar months show two salaries or none. */
  shiftDetected: boolean;
  /** Salary attributed to the month it pays for (calendar month unless shiftDetected). */
  months: { month: string; amount: number; paidOn: string[] }[];
  /** Calendar months with no salary and with more than one. */
  calendarGaps: string[];
  calendarDoubles: string[];
  median: number;
  average: number;
  note: string | null;
};

/**
 * Assigns salary payments to the month they pay for. When calendar months are uneven (some with none, some with two)
 * and moving payments made on the 25th or later to the next month evens them out, that attribution is used.
 */
export function salaryMonths(window: string[], txs: { date: string; amount: number }[]): SalaryMonths {
  const empty = { shiftDetected: false, months: window.map((m) => ({ month: m, amount: 0, paidOn: [] })), calendarGaps: [], calendarDoubles: [], median: 0, average: 0, note: null };
  if (!txs.length) return empty;
  const attribute = (shift: boolean) => {
    const by = new Map(window.map((m) => [m, { month: m, amount: 0, paidOn: [] as string[] }]));
    for (const t of txs) {
      const m = shift && Number(t.date.slice(8)) >= LATE_PAYDAY ? addMonths(t.date.slice(0, 7), 1) : t.date.slice(0, 7);
      const e = by.get(m);
      if (!e) continue;
      e.amount += t.amount;
      e.paidOn.push(t.date);
    }
    return [...by.values()];
  };
  const spread = (ms: { paidOn: string[] }[]) => {
    const counts = ms.map((x) => x.paidOn.length);
    return Math.max(...counts) - Math.min(...counts);
  };
  const calendar = attribute(false);
  const shifted = attribute(true);
  const calendarGaps = calendar.filter((x) => !x.paidOn.length).map((x) => x.month);
  const calendarDoubles = calendar.filter((x) => x.paidOn.length > 1).map((x) => x.month);
  const shiftDetected = calendarGaps.length > 0 && calendarDoubles.length > 0 && spread(shifted) < spread(calendar);
  const months = shiftDetected ? shifted : calendar;
  const amounts = months.map((x) => x.amount);
  return {
    shiftDetected,
    months,
    calendarGaps,
    calendarDoubles,
    median: median(amounts),
    average: average(amounts),
    note: shiftDetected
      ? `Salary paid late in a month counts for the next month: ${calendarDoubles.join(", ")} had two salaries by date and ${calendarGaps.join(", ")} had none.`
      : calendarGaps.length || calendarDoubles.length
        ? "Salary was uneven across months; the median is used."
        : null,
  };
}

export function incomeSources(window: string[], txs: IncomeTx[], names: Map<string, string>): { sources: IncomeSource[]; salary: SalaryMonths } {
  const inWindow = new Set(window);
  const bySlug = new Map<string, IncomeTx[]>();
  for (const t of txs) {
    // Salary subcategories are one source: the shift detection needs all of it together.
    const k = t.slug && SALARY.test(t.slug) ? "income/salary" : (t.slug ?? "");
    bySlug.set(k, [...(bySlug.get(k) ?? []), t]);
  }
  const salaryTx = txs.filter((t) => t.slug && SALARY.test(t.slug));
  const salary = salaryMonths(window, salaryTx);

  const sources: IncomeSource[] = [];
  for (const [k, list] of bySlug) {
    const slug = k || null;
    const byMonth = window.map((m) => ({ month: m, amount: list.filter((t) => t.date.startsWith(m)).reduce((s, t) => s + t.amount, 0) }));
    if (!list.some((t) => inWindow.has(t.date.slice(0, 7)))) continue;
    const isSalary = slug === "income/salary";
    const present = (isSalary ? salary.months : byMonth).filter((x) => x.amount > 0).length;
    const amounts = byMonth.map((x) => x.amount);
    let reason: string | null = null;
    if (slug === null) reason = "Uncategorised money in; categorise it to count it as income.";
    else if (IRREGULAR_SLUGS.has(slug)) reason = "One-off by nature (gifts, refunds, other income).";
    else if (present < window.length / 2) reason = `Only in ${present} of ${window.length} months.`;
    const avg = average(amounts);
    const med = median(amounts);
    // Salary: the median of the months it pays for. Other regular income: the lower of average and median.
    const typical = isSalary ? salary.median : Math.min(avg, med);
    sources.push({
      slug,
      name: slug ? (names.get(slug) ?? slug) : "Uncategorised income",
      byMonth,
      monthsPresent: present,
      average: avg,
      median: med,
      irregular: reason !== null,
      reason,
      recurring: reason ? 0 : typical,
    });
  }
  sources.sort((a, b) => b.average - a.average);
  return { sources, salary };
}

export type SpendingExclusion = LargeExpense & {
  month: string;
  threshold: number;
  /** "expense": a one-off taken out. "refund": money back into an expense category taken out with it (amount is negative spending). */
  kind: "expense" | "refund";
  /** For a refund: the one-off expense it offsets; null when it is a large one-off inflow on its own. */
  pairedWith: string | null;
};

export type SpendingBaseline = {
  /** `excluded` is net: one-offs minus the refunds taken out with them. `core` never goes below zero. */
  byMonth: { month: string; total: number; excluded: number; core: number; outliers: number; refunds: number }[];
  average: number;
  median: number;
  coreAverage: number;
  coreMedian: number;
  /** What a plan uses: the higher of the core average and median (conservative). */
  monthly: number;
  excluded: SpendingExclusion[];
  categories: { slug: string | null; name: string; average: number; coreAverage: number }[];
};

/** A refund pairs with a one-off when it is in the same top-level category, within this many days, and at least this share of it. */
export const REFUND_PAIR_DAYS = 31;
export const REFUND_PAIR_SHARE = 0.5;

function daysApart(a: string, b: string) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Spending per month and per top-level category, with one-off outliers taken out: a single expense larger than both
 * `outlierMin` and `outlierShare` of its month's gross spending.
 *
 * Money that came back into an expense category for a one-off (a cancelled order's refund, a spouse's share of a
 * renovation) is taken out with it: positive amounts in the same top-level category within ±31 days and at least half
 * the one-off, paired greedily from the largest one-off down (closest amount, then closest date). Without this the
 * refund stays in the month and drags core spending far below normal. A large inflow (above the month's threshold) with
 * no one-off to pair with, e.g. the refund of something bought before the window, is taken out as well. A month's core
 * spending is therefore its non-one-off expenses minus ordinary refunds, never below zero.
 *
 * `monthly` stays the higher of the core average and the core median. With refunds paired, both describe non-outlier
 * spending and are close; the median alone would under-count a household whose spending is creeping up or has one
 * expensive month that is not a single one-off, and a plan should err on the side of more spending.
 */
export function spendingBaseline(
  window: string[],
  byCategory: CategoryMonth[],
  large: LargeExpense[],
  names: Map<string, string>,
  opts: BaselineOptions = DEFAULT_BASELINE_OPTIONS,
  inflows: ExpenseInflow[] = [],
): SpendingBaseline {
  const totals = new Map(window.map((m) => [m, 0]));
  const gross = new Map(window.map((m) => [m, 0]));
  for (const r of byCategory) {
    if (!totals.has(r.month)) continue;
    totals.set(r.month, totals.get(r.month)! + r.total);
    gross.set(r.month, gross.get(r.month)! + (r.out ?? r.total));
  }
  const thresholdOf = (m: string) => Math.max(opts.outlierMin, Math.round(gross.get(m)! * opts.outlierShare));

  const outliers: SpendingExclusion[] = [];
  for (const e of large) {
    const m = e.date.slice(0, 7);
    if (!totals.has(m)) continue;
    const threshold = thresholdOf(m);
    if (e.amount > threshold) outliers.push({ ...e, month: m, threshold, kind: "expense", pairedWith: null });
  }
  outliers.sort((a, b) => b.amount - a.amount);

  // Pair refunds with one-offs, largest one-off first.
  const used = new Set<string>();
  const candidates = inflows.filter((r) => r.amount > 0 && r.slug !== null && totals.has(r.date.slice(0, 7)));
  const refunds = new Map<string, SpendingExclusion>();
  for (const o of outliers) {
    let best: ExpenseInflow | null = null;
    for (const r of candidates) {
      if (used.has(r.id) || r.slug !== o.slug || r.amount < o.amount * REFUND_PAIR_SHARE || daysApart(r.date, o.date) > REFUND_PAIR_DAYS) continue;
      const better =
        !best ||
        Math.abs(r.amount - o.amount) < Math.abs(best.amount - o.amount) ||
        (Math.abs(r.amount - o.amount) === Math.abs(best.amount - o.amount) && daysApart(r.date, o.date) < daysApart(best.date, o.date));
      if (better) best = r;
    }
    if (!best) continue;
    used.add(best.id);
    const m = best.date.slice(0, 7);
    refunds.set(o.id, { ...best, amount: -best.amount, month: m, threshold: thresholdOf(m), kind: "refund", pairedWith: o.id });
  }
  const lone: SpendingExclusion[] = [];
  for (const r of candidates) {
    if (used.has(r.id)) continue;
    const m = r.date.slice(0, 7);
    const threshold = thresholdOf(m);
    if (r.amount > threshold) lone.push({ ...r, amount: -r.amount, month: m, threshold, kind: "refund", pairedWith: null });
  }
  lone.sort((a, b) => a.amount - b.amount);
  const excluded = [...outliers.flatMap((o) => (refunds.has(o.id) ? [o, refunds.get(o.id)!] : [o])), ...lone];

  const byMonth = window.map((m) => {
    const total = totals.get(m) ?? 0;
    const outs = excluded.filter((e) => e.month === m && e.kind === "expense").reduce((s, e) => s + e.amount, 0);
    const back = excluded.filter((e) => e.month === m && e.kind === "refund").reduce((s, e) => s - e.amount, 0);
    return { month: m, total, excluded: outs - back, core: Math.max(0, total - outs + back), outliers: outs, refunds: back };
  });
  const cats = new Map<string, { slug: string | null; total: number; excluded: number }>();
  for (const r of byCategory) {
    if (!totals.has(r.month)) continue;
    const k = r.slug ?? "";
    const c = cats.get(k) ?? { slug: r.slug, total: 0, excluded: 0 };
    c.total += r.total;
    cats.set(k, c);
  }
  for (const e of excluded) {
    const c = cats.get(e.slug ?? "");
    if (c) c.excluded += e.amount;
  }
  const n = window.length || 1;
  const categories = [...cats.values()]
    .map((c) => ({
      slug: c.slug,
      name: c.slug ? (names.get(c.slug) ?? c.slug) : "Uncategorized",
      average: wholeUnits(c.total / n),
      coreAverage: Math.max(0, wholeUnits((c.total - c.excluded) / n)),
    }))
    .filter((c) => c.average > 0 || c.coreAverage > 0)
    .sort((a, b) => b.coreAverage - a.coreAverage);
  const core = byMonth.map((x) => x.core);
  const coreAverage = average(core);
  const coreMedian = median(core);
  return {
    byMonth,
    average: average(byMonth.map((x) => x.total)),
    median: median(byMonth.map((x) => x.total)),
    coreAverage,
    coreMedian,
    monthly: Math.max(coreAverage, coreMedian),
    excluded,
    categories,
  };
}

/** One transfer category in one month: money paid out of it and back into it, positive minor units. */
export type TransferMonth = { slug: string; name: string; month: string; out: number; in: number };

export type InstallmentCategory = {
  slug: string;
  name: string;
  /** Typical monthly payment, net of anything paid back into the category. */
  monthly: number;
  /** Months with a net payment, the ones counted. */
  months: string[];
  netPaid: number;
};

export type ExistingInstallments = {
  monthly: number;
  categories: InstallmentCategory[];
  /** Debt-looking transfer categories that were not counted, and why. */
  skipped: { slug: string; name: string; reason: string; months: string[] }[];
};

/** Paying off the household's own debt. */
const DEBT = /cicilan|angsuran|\bkpr\b|\bkkb\b|kredit|credit|paylater|pay[ -]later|leasing|installment|instalment|mortgage|\bloans?\b|pinjaman|hutang|utang|\bkta\b/i;
/** Money lent to someone else, not the household's debt. */
const LENT = /pinjaman ke|pinjam(?:an)? (?:untuk|buat)|piutang|dipinjam|\bloans? to\b|\blent\b|\blend(?:ing)?\b|family|keluarga|saudara|\badik\b|\bkakak\b|teman|friend/i;
/** Card bills settle purchases that are already spending; counting them would count that spending twice. */
const CARD_BILL = /kartu kredit|credit[ -]card|\bcc\b/i;
const INSTALLMENT_WORD = /cicilan|angsuran|installment|instalment/i;

/**
 * Existing loan installments from transfer categories: only money the household pays toward its own debt (cicilan,
 * angsuran, KPR, kredit, paylater, leasing, loans), never money lent to others or plain card-bill payments. Money paid
 * back into the category is netted out, and the payment must recur: present in at least half the months and in one of
 * the last two (a loan paid off earlier is no longer an installment). The monthly figure is the median of the months
 * paid, capped by the net paid over those months.
 */
export function existingInstallments(window: string[], rows: TransferMonth[]): ExistingInstallments {
  const inWindow = new Set(window);
  const bySlug = new Map<string, { name: string; rows: TransferMonth[] }>();
  for (const r of rows) {
    if (!inWindow.has(r.month)) continue;
    const e = bySlug.get(r.slug) ?? { name: r.name, rows: [] };
    e.rows.push(r);
    bySlug.set(r.slug, e);
  }
  const categories: InstallmentCategory[] = [];
  const skipped: ExistingInstallments["skipped"] = [];
  const recent = new Set(window.slice(-2));
  const needed = Math.ceil(window.length / 2);
  for (const [slug, { name, rows: list }] of bySlug) {
    const text = `${slug} ${name}`;
    if (!DEBT.test(text) && slug !== "transfer/credit-card") continue;
    const perMonth = window.map((m) => {
      const xs = list.filter((r) => r.month === m);
      return { month: m, out: xs.reduce((s, r) => s + r.out, 0), in: xs.reduce((s, r) => s + r.in, 0) };
    });
    const paid = perMonth.filter((x) => x.out - x.in > 0);
    const months = paid.map((x) => x.month);
    const netPaid = perMonth.reduce((s, x) => s + x.out - x.in, 0);
    const skip = (reason: string) => skipped.push({ slug, name, reason, months });
    if (LENT.test(text)) skip("Money lent to others, not the household's own debt.");
    else if ((slug === "transfer/credit-card" || CARD_BILL.test(text)) && !INSTALLMENT_WORD.test(text))
      skip("Credit-card bill payments settle purchases already counted as spending.");
    else if (netPaid <= 0) skip("Paid back as much as was paid out.");
    else if (paid.length < needed) skip(`Paid in only ${paid.length} of ${window.length} months.`);
    else if (!paid.some((x) => recent.has(x.month))) skip(`Last paid in ${months[months.length - 1]}; looks finished.`);
    else {
      const monthly = Math.min(median(paid.map((x) => x.out - x.in)), wholeUnits(netPaid / paid.length));
      categories.push({ slug, name, monthly, months, netPaid });
    }
  }
  categories.sort((a, b) => b.monthly - a.monthly);
  return { monthly: categories.reduce((s, x) => s + x.monthly, 0), categories, skipped };
}

const LIQUID_TYPES = new Set(["bank", "ewallet", "cash"]);
const EMERGENCY = /darurat|emergency|cadangan/i;
const GOAL = /mobil|\bcar\b|rumah|house|haji|hajj|umro?h|nikah|wedding|pendidikan|education|sekolah|liburan|holiday|vacation|tabungan|saving|goal|\bdp\b|investasi/i;
const SPENDING = /belanja|jajan|harian|daily|spend|bills?|tagihan|makan|bulanan|monthly/i;
const JAGO_MAIN = /main|utama/i;

/** A role for an account from its type and name; a suggestion the user can change. */
export function suggestRole(a: Pick<PlanAccount, "name" | "institution" | "type">): { role: AccountRole; reason: string } {
  if (!LIQUID_TYPES.has(a.type)) {
    return { role: "exclude", reason: a.type === "investment" ? "Investments are not counted as cash." : "Not cash (card, loan or other)." };
  }
  if (EMERGENCY.test(a.name)) return { role: "emergency", reason: "Name says emergency fund." };
  if (GOAL.test(a.name)) return { role: "goal", reason: "Name looks like a savings goal." };
  if (a.institution === "jago" && !JAGO_MAIN.test(a.name) && !SPENDING.test(a.name)) return { role: "goal", reason: "A Jago pocket other than Main." };
  return { role: "spending", reason: "Everyday account." };
}

export function roleTotals(accounts: { role: AccountRole; balance: number }[]) {
  const t = { emergency: 0, goal: 0, spending: 0 };
  for (const a of accounts) if (a.role !== "exclude") t[a.role] += a.balance;
  return t;
}
