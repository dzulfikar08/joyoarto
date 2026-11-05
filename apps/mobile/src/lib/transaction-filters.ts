// The Transactions tab's filters (the web keeps them in the URL; here they are route params, so Home can open a
// filtered list), the search input they make, date presets, day sections, and the categorize call with "remember
// this merchant" (the web's rule-from-row behaviour). Pure, unit-tested.

import { addDays, currentMonthWib, daySectionTitle, isDay, monthEnd, shiftMonth, todayWib } from "./format";

export type Status = "" | "pending" | "posted";
/** Reimbursable ("diganti kantor") rows: any marked, the open ones (not paid back yet), or none. */
export type ReimburseFilter = "" | "any" | "open" | "none";
const REIMBURSE_FILTERS: readonly string[] = ["any", "open", "none"];
export type Filters = { q: string; accountId: string; category: string; uncategorized: boolean; from: string; to: string; status: Status; reimburse: ReimburseFilter };

export const EMPTY_FILTERS: Filters = { q: "", accountId: "", category: "", uncategorized: false, from: "", to: "", status: "", reimburse: "" };

const str = (v: unknown): string => (Array.isArray(v) ? str(v[0]) : typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Route params (strings) to filters, dropping anything malformed. */
export function filtersFromParams(raw: Record<string, unknown>): Filters {
  const from = str(raw.from);
  const to = str(raw.to);
  const status = str(raw.status);
  const unc = str(raw.uncategorized);
  return {
    q: str(raw.q).slice(0, 40),
    accountId: str(raw.accountId),
    category: str(raw.category),
    uncategorized: unc === "true" || unc === "1",
    from: isDay(from) ? from : "",
    to: isDay(to) ? to : "",
    status: status === "pending" || status === "posted" ? status : "",
    reimburse: REIMBURSE_FILTERS.includes(str(raw.reimburse)) ? (str(raw.reimburse) as ReimburseFilter) : "",
  };
}

/** Filters to route params (only the ones set). */
export function filtersToParams(f: Partial<Filters>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === "" || v === false || v === undefined) continue;
    out[k] = v === true ? "true" : String(v);
  }
  return out;
}

export function activeFilterCount(f: Filters): number {
  return [f.accountId, f.category, f.uncategorized, f.from || f.to, f.status, f.reimburse].filter(Boolean).length;
}

export function isFiltered(f: Filters): boolean {
  return activeFilterCount(f) > 0 || !!f.q.trim();
}

export type SearchInput = {
  limit: number;
  q?: string;
  accountId?: string;
  category?: string;
  uncategorized?: boolean;
  from?: string;
  to?: string;
  status?: "pending" | "posted";
  reimburse?: "any" | "open" | "none";
};

export function searchInput(f: Filters, limit = 50): SearchInput {
  return {
    limit,
    ...(f.q.trim() ? { q: f.q.trim().slice(0, 40) } : {}),
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.category && !f.uncategorized ? { category: f.category } : {}),
    ...(f.uncategorized ? { uncategorized: true } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.reimburse ? { reimburse: f.reimburse } : {}),
  };
}

export type DatePreset = { key: string; label: string; from: string; to: string };

export function datePresets(now = new Date()): DatePreset[] {
  const today = todayWib(now);
  const month = currentMonthWib(now);
  const last = shiftMonth(month, -1);
  return [
    { key: "this-month", label: "This month", from: `${month}-01`, to: today },
    { key: "last-month", label: "Last month", from: `${last}-01`, to: monthEnd(last) },
    { key: "30d", label: "Last 30 days", from: addDays(today, -29), to: today },
    { key: "90d", label: "Last 90 days", from: addDays(today, -89), to: today },
  ];
}

export function presetOf(f: Pick<Filters, "from" | "to">, now = new Date()): string | null {
  return datePresets(now).find((p) => p.from === f.from && p.to === f.to)?.key ?? null;
}

/** Rows (newest first) to day sections for a SectionList. */
export function groupByDay<T extends { date: string }>(rows: readonly T[], today = todayWib()): { title: string; day: string; data: T[] }[] {
  const sections: { title: string; day: string; data: T[] }[] = [];
  for (const r of rows) {
    const last = sections.at(-1);
    if (last && last.day === r.date) last.data.push(r);
    else sections.push({ title: daySectionTitle(r.date, today), day: r.date, data: [r] });
  }
  return sections;
}

/**
 * What a category pick sends: clearing is an update; a category is `transactions.categorize`, with a rule
 * (merchant equals, applied to past uncategorized rows) when "remember" is on and the row has a merchant.
 */
export function categorizeCall(
  tx: { id: string; merchant: string | null },
  category: string | null,
  remember: boolean,
):
  | { kind: "clear"; input: { id: string; category: null } }
  | {
      kind: "categorize";
      input: { ids: string[]; category: string; createRule?: { field: "merchant"; match: "equals"; pattern: string; applyToExisting: boolean } };
    } {
  if (!category) return { kind: "clear", input: { id: tx.id, category: null } };
  const merchant = tx.merchant?.trim();
  return {
    kind: "categorize",
    input: {
      ids: [tx.id],
      category,
      ...(remember && merchant ? { createRule: { field: "merchant", match: "equals", pattern: merchant.slice(0, 100), applyToExisting: true } } : {}),
    },
  };
}

/** "Rule saved: merchant = X → food (also applied to 3 more)". */
export function ruleSavedText(res: { rule: { when: string } | null; category: string; ruleAppliedToExisting: number }): string | null {
  if (!res.rule) return null;
  return `${res.rule.when} → ${res.category}${res.ruleAppliedToExisting ? ` (also applied to ${res.ruleAppliedToExisting} more)` : ""}`;
}
