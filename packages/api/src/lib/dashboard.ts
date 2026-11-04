// Pure helpers behind reports.dashboard: month arithmetic, deltas, the cumulative spending series, account grouping.

export function monthBounds(m: string): { from: string; to: string; days: number } {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(days).padStart(2, "0")}`, days };
}

/** Today's calendar day in WIB (UTC+7). */
export function todayWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, by: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** Relative change in percent, one decimal; null when there is nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Running spending total per day of month for the selected month and the one before, aligned by day number. The
 * selected month stops at `today` when it is the current month (later days are null, not flat). A previous month
 * shorter than the selected one holds its final total.
 */
export function cumulativeByDay(
  month: string,
  prevMonth: string,
  daily: { date: string; amount: number }[],
  today: string,
): { day: number; current: number | null; previous: number }[] {
  const cur = monthBounds(month);
  const prev = monthBounds(prevMonth);
  const curBy = new Map<number, number>();
  const prevBy = new Map<number, number>();
  for (const r of daily) {
    const m = r.date.slice(0, 7);
    const d = Number(r.date.slice(8));
    if (m === month) curBy.set(d, (curBy.get(d) ?? 0) + r.amount);
    else if (m === prevMonth) prevBy.set(d, (prevBy.get(d) ?? 0) + r.amount);
  }
  const lastDay = today.slice(0, 7) === month ? Number(today.slice(8)) : today < cur.from ? 0 : cur.days;
  const out: { day: number; current: number | null; previous: number }[] = [];
  let c = 0;
  let p = 0;
  for (let d = 1; d <= cur.days; d++) {
    c += curBy.get(d) ?? 0;
    if (d <= prev.days) p += prevBy.get(d) ?? 0;
    out.push({ day: d, current: d <= lastDay ? c : null, previous: p });
  }
  // Anything the previous month spent after the selected month's last day still counts toward its total.
  for (let d = cur.days + 1; d <= prev.days; d++) p += prevBy.get(d) ?? 0;
  if (out.length && prev.days > cur.days) out[out.length - 1]!.previous = p;
  return out;
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: "Bank",
  ewallet: "E-wallets",
  cash: "Cash",
  investment: "Investments",
  credit_card: "Credit cards",
  loan: "Loans",
  other: "Other",
};

const TYPE_ORDER = Object.keys(ACCOUNT_TYPE_LABELS);

/** Accounts grouped by type in a fixed order, with subtotals in one currency (others are listed but not summed). */
export function groupAccounts<A extends { type: string; currency: string; balance: { amount: number } }>(accounts: A[], currency: string) {
  const groups = new Map<string, A[]>();
  for (const a of accounts) groups.set(a.type, [...(groups.get(a.type) ?? []), a]);
  const sum = (xs: A[]) => xs.filter((a) => a.currency === currency).reduce((s, a) => s + a.balance.amount, 0);
  return {
    groups: [...groups]
      .sort(([x], [y]) => TYPE_ORDER.indexOf(x) - TYPE_ORDER.indexOf(y))
      .map(([type, items]) => ({ type, label: ACCOUNT_TYPE_LABELS[type] ?? type, total: sum(items), accounts: items })),
    total: sum(accounts),
  };
}

/** Accounts with no transaction in `days` days, or none at all, oldest activity first. */
export function staleAccounts<A extends { lastDate: string | null }>(accounts: A[], today: string, days = 35): A[] {
  const cutoff = addDays(today, -days);
  return accounts
    .filter((a) => a.lastDate === null || a.lastDate <= cutoff)
    .sort((x, y) => (x.lastDate ?? "").localeCompare(y.lastDate ?? ""));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Below this income (minor units, Rp 500.000) a savings rate says more about timing than about saving. */
export const SAVINGS_RATE_MIN_INCOME_IDR = 50_000_000;

export type SavingsRateNote = "too-early" | "out-of-range" | null;

/**
 * Savings rate in percent (one decimal), or null with a reason when it would mislead: income below `minIncome`, or
 * below 10% of `referenceIncome` (the same window a month earlier; early in a month the salary may not be in yet), or a
 * rate outside −100%…100%.
 */
export function savingsRate(
  income: number,
  spending: number,
  opts: { minIncome?: number; referenceIncome?: number } = {},
): { value: number | null; note: SavingsRateNote } {
  const ref = opts.referenceIncome ?? 0;
  if (income <= 0 || income < (opts.minIncome ?? 0) || (ref > 0 && income < ref * 0.1)) return { value: null, note: "too-early" };
  const value = Math.round(((income - spending) / income) * 1000) / 10;
  if (value < -100 || value > 100) return { value: null, note: "out-of-range" };
  return { value, note: null };
}

/**
 * Spending per top-level category for `month`, compared with the month before two ways: over the same comparison
 * window the KPIs use (`previous`, the 1st to the cutoff day) and over the whole previous month (`previousFullMonth`).
 * Rows are expense sums from SQL (negative = money out), one per slug and month; `window` is the part of a
 * previous-month row dated inside the comparison window.
 */
export function categoryComparison(rows: { slug: string | null; month: string; total: number; window: number; count: number }[], month: string) {
  const by = new Map<string, { slug: string | null; current: number; count: number; previousWindow: number; previousMonth: number }>();
  for (const r of rows) {
    const k = r.slug ?? "";
    const e = by.get(k) ?? { slug: r.slug, current: 0, count: 0, previousWindow: 0, previousMonth: 0 };
    if (r.month === month) {
      e.current -= r.total;
      e.count += r.count;
    } else {
      e.previousMonth -= r.total;
      e.previousWindow -= r.window;
    }
    by.set(k, e);
  }
  const total = [...by.values()].reduce((s, x) => s + Math.max(0, x.current), 0);
  return [...by.values()]
    .filter((x) => x.current > 0)
    .sort((a, b) => b.current - a.current)
    .map((x) => ({
      slug: x.slug,
      current: x.current,
      count: x.count,
      previous: Math.max(0, x.previousWindow),
      changePct: pctChange(x.current, x.previousWindow),
      previousFullMonth: Math.max(0, x.previousMonth),
      changePctFullMonth: pctChange(x.current, x.previousMonth),
      share: total ? Math.round((x.current / total) * 1000) / 10 : 0,
    }));
}
