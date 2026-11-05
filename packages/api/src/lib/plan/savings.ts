// "Where to save": everyday habits the household could cut, from its own history only (no national averages or
// "healthy" norms), and what a cut does to the plan. Pure and deterministic; the service (services/savings.ts) fetches
// the rows with the same complete months, outliers and income the plan baseline uses.
import { average, wholeUnits } from "./months";
import type { CutItem, RuleOptions, ScenarioItem } from "./schema";
import { simulate } from "./simulate";
import type { RuleStatus, SimBaseline, SimResult } from "./simulate";

/** Discretionary categories looked at by default. Their household-defined children count too. */
export const DEFAULT_HABIT_SLUGS = ["food/coffee", "food/snacks", "food/dining", "food/delivery", "transport/ride-hailing", "shopping/online"] as const;

/** Categories where a monthly cap fits better than a frequency: tickets vary too much for "x times a week". */
const CAP_SLUG = /^shopping(\/|$)/;

/** Minimarket chains, matched on the cleaned merchant (or the bank's text when there is none), case-insensitive. */
export const MINIMARKET = /\b(indomaret|alfa ?mart|alfa ?midi|lawson|family ?mart|circle ?k)\b/i;
const MINIMARKET_BRANDS: [RegExp, string][] = [
  [/indomaret/i, "Indomaret"],
  [/alfa ?midi/i, "Alfamidi"],
  [/alfa ?mart/i, "Alfamart"],
  [/lawson/i, "Lawson"],
  [/family ?mart/i, "FamilyMart"],
  [/circle ?k/i, "Circle K"],
];
export const MINIMARKET_KEY = "minimarket";
/** A minimarket basket at or under this is a snack run, not the weekly shop. Rp 100.000. */
export const DEFAULT_MINIMARKET_MAX = 10_000_000;

/** Enough data to suggest a cut: at least this many complete months and this many purchases a month on average. */
export const MIN_MONTHS = 2;
export const MIN_PER_MONTH = 4;
/** A trend is "up" or "down" from this change on. */
const TREND_PCT = 15;
/** Frequencies of at least this many a week are phrased per week, lower ones per month. */
const WEEKLY_FROM = 1.5;

/** One outflow, positive minor units. */
export type HabitRow = { id: string; date: string; amount: number; merchant: string | null; description: string; slug: string | null };

export type HabitOption = {
  /** Times per week or per month (frequency), or the monthly cap in minor units (cap). */
  target: number;
  /** Monthly saving at this target, minor units. */
  saving: number;
};

export type HabitSuggestion = {
  unit: "week" | "month" | "cap";
  /** Today: times per week/month (one decimal), or the monthly spend for a cap. */
  current: number;
  /** The suggested target (one of `options`). */
  target: number;
  saving: number;
  /** Every target to choose from, highest (smallest change) first. */
  options: HabitOption[];
};

export type Habit = {
  /** A category slug, or "minimarket". */
  key: string;
  kind: "category" | "minimarket";
  name: string;
  /** The household's categories counted (the slug and its children); empty for minimarket. */
  slugs: string[];
  count: number;
  total: number;
  /** Average spend per month, minor units. */
  monthly: number;
  perMonth: number;
  perWeek: number;
  averageTicket: number;
  byMonth: { month: string; amount: number; count: number }[];
  trend: { direction: "up" | "down" | "flat" | "new"; pct: number | null; recent: number; earlier: number; compares: string };
  topMerchants: { name: string; amount: number; count: number }[];
  /** Share of the household's recurring income; null without income. */
  incomeSharePct: number | null;
  suggestion: HabitSuggestion | null;
  /** The cut counts toward the total and the plan: there is a suggestion and the member did not keep the habit as is. */
  included: boolean;
  /** Why there is no suggestion. */
  reason: string | null;
};

export type HabitsInput = {
  /** Complete months with data, oldest first. */
  months: string[];
  rows: HabitRow[];
  /** The household's categories, slug -> name. */
  categories: Map<string, string>;
  habitSlugs?: readonly string[];
  minimarketMax?: number;
  monthlyIncome: number;
  /** Rows the plan baseline left out as one-offs. */
  excludedIds?: Set<string>;
  /** Chosen targets by habit key (null: keep this habit as it is); the suggestion is used for the others. */
  targets?: Record<string, number | null>;
};

export type HabitsResult = {
  habits: Habit[];
  /** Habit categories the household does not have (renamed slugs or deleted). */
  missing: string[];
  /** Sum of the included habits' chosen (or suggested) savings, minor units a month. */
  totalSaving: number;
  months: string[];
};

const r1 = (x: number) => Math.round(x * 10) / 10;

function daysIn(m: string): number {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The most specific habit slug a category slug falls under (itself or a parent), or null. */
function habitOf(slug: string | null, habitSlugs: string[]): string | null {
  if (!slug) return null;
  let best: string | null = null;
  for (const h of habitSlugs) {
    if ((slug === h || slug.startsWith(`${h}/`)) && (!best || h.length > best.length)) best = h;
  }
  return best;
}

export function minimarketBrand(text: string): string | null {
  if (!MINIMARKET.test(text)) return null;
  for (const [re, name] of MINIMARKET_BRANDS) if (re.test(text)) return name;
  return null;
}

const label = (r: HabitRow) => (r.merchant?.trim() || r.description.trim().slice(0, 40) || "Unknown");

function topMerchants(rows: HabitRow[], key: (r: HabitRow) => string) {
  const by = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of rows) {
    const name = key(r);
    const k = name.toLowerCase();
    const e = by.get(k) ?? { name, amount: 0, count: 0 };
    e.amount += r.amount;
    e.count += 1;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);
}

/** Last month (or the last three, with six or more months) against the months before. */
export function trendOf(byMonth: { month: string; amount: number }[]): Habit["trend"] {
  if (byMonth.length < 2) return { direction: "flat", pct: null, recent: byMonth[0]?.amount ?? 0, earlier: 0, compares: "" };
  const k = byMonth.length >= 6 ? 3 : 1;
  const recentMonths = byMonth.slice(-k);
  const earlierMonths = byMonth.slice(0, -k);
  const recent = average(recentMonths.map((x) => x.amount));
  const earlier = average(earlierMonths.map((x) => x.amount));
  const compares = k === 1 ? `${recentMonths[0]!.month} vs the ${earlierMonths.length} month(s) before` : `the last 3 months vs the ${earlierMonths.length} before`;
  if (earlier === 0) return { direction: recent > 0 ? "new" : "flat", pct: null, recent, earlier, compares };
  const pct = Math.round(((recent - earlier) / earlier) * 100);
  return { direction: pct >= TREND_PCT ? "up" : pct <= -TREND_PCT ? "down" : "flat", pct, recent, earlier, compares };
}

/** Rounds a cap down to a tidy figure: Rp 50.000 steps, Rp 10.000 under Rp 500.000. */
function tidyCap(minor: number): number {
  const step = minor >= 50_000_000 ? 5_000_000 : 1_000_000;
  return Math.floor(minor / step) * step;
}

/**
 * The cut to suggest. Frequency: times per week (from 1.5 a week) or per month, targets are the whole numbers below
 * today's, at most 8; suggested is one less, or a third less from four on (3x a week -> 2x, 6x -> 4x). The saving is the
 * purchases dropped a month times the average ticket. Cap (shopping): 75%, 50% and 25% of the monthly average, tidied
 * down; suggested 75%.
 */
export function suggest(h: Pick<Habit, "key" | "monthly" | "perMonth" | "perWeek" | "averageTicket">, weeksPerMonth: number, chosen?: number): HabitSuggestion | null {
  if (h.monthly <= 0) return null;
  if (CAP_SLUG.test(h.key)) {
    const caps = [...new Set([0.75, 0.5, 0.25].map((f) => tidyCap(h.monthly * f)))].filter((c) => c > 0 && c < h.monthly);
    if (!caps.length) return null;
    const options = caps.map((c) => ({ target: c, saving: wholeUnits(h.monthly - c) }));
    const pickTarget = chosen !== undefined && chosen >= 0 && chosen < h.monthly ? Math.round(chosen) : options[0]!.target;
    return { unit: "cap", current: h.monthly, target: pickTarget, saving: wholeUnits(Math.max(0, h.monthly - pickTarget)), options };
  }
  const weekly = h.perWeek >= WEEKLY_FROM;
  const current = weekly ? h.perWeek : h.perMonth;
  const top = Math.ceil(current) - 1;
  if (top < 0) return null;
  const perMonthAt = (t: number) => (weekly ? t * weeksPerMonth : t);
  const saving = (t: number) => wholeUnits(Math.max(0, h.perMonth - perMonthAt(t)) * h.averageTicket);
  const targets = Array.from({ length: Math.min(8, top + 1) }, (_, i) => top - i);
  const options = targets.map((t) => ({ target: t, saving: saving(t) })).filter((o) => o.saving > 0);
  if (!options.length) return null;
  const suggested = Math.max(options[options.length - 1]!.target, current >= 4 ? Math.min(top, Math.round((current * 2) / 3)) : top);
  const target = chosen !== undefined && Number.isFinite(chosen) && chosen >= 0 && chosen < current ? chosen : suggested;
  return { unit: weekly ? "week" : "month", current: r1(current), target, saving: saving(target), options };
}

/**
 * Habits from the household's outflows (expenses only: transfers and reimbursable rows never reach here). Each row
 * counts once: a habit category (the most specific one) first, else the minimarket habit when the merchant is a
 * minimarket chain and the basket is at most `minimarketMax`. So minimarket rows already in food/snacks stay there.
 */
export function detectHabits(input: HabitsInput): HabitsResult {
  const months = input.months;
  const inWindow = new Set(months);
  const wanted = [...(input.habitSlugs ?? DEFAULT_HABIT_SLUGS)];
  const present = wanted.filter((s) => input.categories.has(s));
  const missing = wanted.filter((s) => !input.categories.has(s));
  const max = input.minimarketMax ?? DEFAULT_MINIMARKET_MAX;
  const excluded = input.excludedIds ?? new Set<string>();

  const groups = new Map<string, HabitRow[]>([...present.map((s) => [s, [] as HabitRow[]] as const), [MINIMARKET_KEY, []]]);
  for (const r of input.rows) {
    if (r.amount <= 0 || excluded.has(r.id) || !inWindow.has(r.date.slice(0, 7))) continue;
    const h = habitOf(r.slug, present);
    if (h) groups.get(h)!.push(r);
    else if (r.amount <= max && minimarketBrand(r.merchant ?? r.description)) groups.get(MINIMARKET_KEY)!.push(r);
  }

  const n = months.length;
  const days = months.reduce((s, m) => s + daysIn(m), 0);
  const weeks = days / 7;
  const weeksPerMonth = n ? weeks / n : 0;
  const habits: Habit[] = [];
  for (const [key, rows] of groups) {
    if (!rows.length) continue;
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const count = rows.length;
    const byMonth = months.map((m) => {
      const xs = rows.filter((r) => r.date.startsWith(m));
      return { month: m, amount: xs.reduce((s, r) => s + r.amount, 0), count: xs.length };
    });
    const isMini = key === MINIMARKET_KEY;
    const base = {
      key,
      monthly: n ? wholeUnits(total / n) : 0,
      perMonth: n ? r1(count / n) : 0,
      perWeek: weeks ? r1(count / weeks) : 0,
      averageTicket: wholeUnits(total / count),
    };
    const monthsWithSpend = byMonth.filter((x) => x.count > 0).length;
    const reason =
      n < MIN_MONTHS
        ? `Only ${n} complete month(s) of history; at least ${MIN_MONTHS} are needed.`
        : monthsWithSpend < MIN_MONTHS
          ? `Spent in only ${monthsWithSpend} of ${n} months.`
          : count / n < MIN_PER_MONTH
            ? `About ${r1(count / n)} purchases a month; suggestions start at ${MIN_PER_MONTH}.`
            : null;
    // Saving from the unrounded frequency, so 2.96 a week is not treated as 3.
    const exact = { ...base, perMonth: n ? count / n : 0, perWeek: weeks ? count / weeks : 0 };
    const chosen = input.targets?.[key];
    const suggestion = reason ? null : suggest(exact, weeksPerMonth, chosen ?? undefined);
    habits.push({
      ...base,
      kind: isMini ? "minimarket" : "category",
      name: isMini ? "Minimarket snacks" : (input.categories.get(key) ?? key),
      slugs: isMini ? [] : [...new Set(rows.map((r) => r.slug!))].sort(),
      count,
      total,
      byMonth,
      trend: trendOf(byMonth),
      topMerchants: topMerchants(rows, isMini ? (r) => minimarketBrand(r.merchant ?? r.description) ?? label(r) : label),
      incomeSharePct: input.monthlyIncome > 0 ? r1((base.monthly / input.monthlyIncome) * 100) : null,
      suggestion,
      included: !!suggestion && chosen !== null,
      reason: reason ?? (suggestion ? null : "Too few purchases to cut one."),
    });
  }
  habits.sort((a, b) => (b.suggestion?.saving ?? -1) - (a.suggestion?.saving ?? -1) || b.monthly - a.monthly || a.key.localeCompare(b.key));
  return { habits, missing, totalSaving: habits.reduce((s, h) => s + (h.included ? h.suggestion!.saving : 0), 0), months };
}

/** "Kopi: 3x -> 2x a week": the label of a cut in the plan. */
export function cutLabel(h: Pick<Habit, "name">, s: HabitSuggestion, rp: (minor: number) => string): string {
  if (s.unit === "cap") return `${h.name}: at most ${rp(s.target)} a month`;
  return `${h.name}: ${s.current}x -> ${s.target}x a ${s.unit}`;
}

/** Scenario items for the chosen cuts: one per habit with a saving, id "cut:<key>". */
export function cutItems(habits: Habit[], rp: (minor: number) => string, startMonth?: string): CutItem[] {
  return habits
    .filter((h) => h.included && h.suggestion!.saving > 0)
    .map((h) => ({ type: "cut" as const, id: `cut:${h.key}`.slice(0, 40), label: cutLabel(h, h.suggestion!, rp).slice(0, 80), monthly: h.suggestion!.saving, habit: h.key, ...(startMonth ? { startMonth } : {}) }));
}

export type Milestone = {
  id: "emergency" | "goalAmount" | "goalRebuilt";
  title: string;
  /** First month it is reached, or null when not within the plan's horizon. */
  without: string | null;
  with: string | null;
  /** How many months earlier with the cuts; null when neither reaches it, or only the cuts do (see `onlyWithCuts`). */
  monthsSooner: number | null;
  onlyWithCuts: boolean;
};

export type CutEffect = {
  monthlySaving: number;
  milestones: Milestone[];
  verdict: { without: SimResult["verdict"]; with: SimResult["verdict"] };
  /** Rules whose status gets better with the cuts (e.g. a failing car plan that passes). */
  rulesImproved: { id: string; title: string; without: RuleStatus; with: RuleStatus }[];
  endBalance: { without: number; with: number };
};

const RANK: Record<RuleStatus, number> = { fail: 0, warn: 1, ok: 2, info: 3 };

function firstMonth(r: SimResult, ok: (p: SimResult["projection"][number]) => boolean): number {
  return r.projection.findIndex(ok);
}

/**
 * What the cuts change in a plan: the same baseline and items simulated without and with them. Milestones: the
 * emergency fund first covering `rules.emergencyMonths` of outflow, liquid money first reaching `goalAmount` (when
 * given), and the goal savings back to their starting level after the plan uses them (when it does).
 */
export function cutEffect(
  base: SimBaseline,
  items: ScenarioItem[],
  cuts: CutItem[],
  opts: { startMonth: string; horizonMonths: number; rules: RuleOptions },
  goalAmount?: number,
): CutEffect {
  const plain = items.filter((i) => i.type !== "cut");
  const without = simulate(base, plain, opts);
  const withCuts = simulate(base, [...plain, ...cuts], opts);
  const milestone = (id: Milestone["id"], title: string, a: number, b: number): Milestone => {
    const month = (r: SimResult, i: number) => (i >= 0 ? r.projection[i]!.month : null);
    return {
      id,
      title,
      without: month(without, a),
      with: month(withCuts, b),
      monthsSooner: a >= 0 && b >= 0 ? a - b : null,
      onlyWithCuts: a < 0 && b >= 0,
    };
  };
  const target = opts.rules.emergencyMonths;
  const milestones: Milestone[] = [
    milestone(
      "emergency",
      `Emergency fund covers ${target} months`,
      firstMonth(without, (p) => p.emergencyCoverMonths >= target),
      firstMonth(withCuts, (p) => p.emergencyCoverMonths >= target),
    ),
  ];
  if (goalAmount && goalAmount > 0) {
    milestones.push(milestone("goalAmount", "Liquid money reaches the goal", firstMonth(without, (p) => p.total >= goalAmount), firstMonth(withCuts, (p) => p.total >= goalAmount)));
  }
  const goalStart = base.balances.goal;
  const drop = without.projection.findIndex((p) => p.balances.goal < goalStart);
  if (drop >= 0) {
    const back = (r: SimResult) => r.projection.findIndex((p, i) => i > drop && p.balances.goal >= goalStart);
    milestones.push(milestone("goalRebuilt", "Goal savings back to today's level", back(without), back(withCuts)));
  }
  const rulesImproved = withCuts.rules
    .map((w) => ({ w, o: without.rules.find((x) => x.id === w.id) }))
    .filter(({ w, o }) => o && w.status !== "info" && RANK[w.status] > RANK[o.status])
    .map(({ w, o }) => ({ id: w.id, title: w.title, without: o!.status, with: w.status }));
  return {
    monthlySaving: cuts.reduce((s, c) => s + c.monthly, 0),
    milestones,
    verdict: { without: without.verdict, with: withCuts.verdict },
    rulesImproved,
    endBalance: { without: without.summary.end, with: withCuts.summary.end },
  };
}
