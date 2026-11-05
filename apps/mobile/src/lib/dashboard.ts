// What the Home dashboard computes from reports.dashboard (the web's apps/web/src/routes/-dashboard.tsx): donut
// slices (six biggest + "Other"), change texts, the comparison period, the "needs attention" list, chart geometry.
// Pure, unit-tested.

import type { AppRouterClient, Out } from "./rpc";
import { addDays, formatMoney, monthLabel, plural } from "./format";

export type Dashboard = Out<AppRouterClient["reports"]["dashboard"]>;
export type CategoryRow = Dashboard["categories"][number];

export const TOP_SLICES = 6;
export const OTHER = "__other";

export type Slice = { key: string; label: string; value: number; display: string; share: number; colorIndex: number | null };

/** Category rows' key: the slug, or "none" for uncategorized spending. */
export const keyOf = (c: { slug: string | null }) => c.slug ?? "none";

/** The six biggest categories get the six chart colours; the rest fold into one neutral "Other" slice. */
export function donutSlices(d: Pick<Dashboard, "categories" | "currency">): { slices: Slice[]; top: CategoryRow[]; rest: CategoryRow[]; other: OtherRow | null } {
  const top = d.categories.slice(0, TOP_SLICES);
  const rest = d.categories.slice(top.length);
  const other = otherRow(rest, d.currency);
  const slices: Slice[] = [
    ...top.map((c, i) => ({ key: keyOf(c), label: c.name, value: c.amount, display: c.display, share: c.share, colorIndex: i })),
    ...(other ? [{ key: OTHER, label: "Other", value: other.amount, display: other.display, share: other.share, colorIndex: null }] : []),
  ];
  return { slices, top, rest, other };
}

export type OtherRow = { amount: number; display: string; share: number; previous: { amount: number; display: string }; previousFullMonth: { amount: number }; changePct: number | null };

function otherRow(rest: CategoryRow[], currency: string): OtherRow | null {
  if (!rest.length) return null;
  const amount = rest.reduce((s, c) => s + c.amount, 0);
  const previous = rest.reduce((s, c) => s + c.previous.amount, 0);
  const previousFull = rest.reduce((s, c) => s + c.previousFullMonth.amount, 0);
  return {
    amount,
    display: formatMoney(amount, currency),
    share: Math.round(rest.reduce((s, c) => s + c.share, 0) * 10) / 10,
    previous: { amount: previous, display: formatMoney(previous, currency) },
    previousFullMonth: { amount: previousFull },
    changePct: previous > 0 ? Math.round(((amount - previous) / previous) * 1000) / 10 : null,
  };
}

/** "+12%", "new" (nothing last month), "–" (no comparable period). */
export function changeText(c: { changePct: number | null; previousFullMonth: { amount: number } }): string {
  if (c.changePct === null) return c.previousFullMonth.amount > 0 ? "–" : "new";
  return `${c.changePct > 0 ? "+" : ""}${Math.abs(c.changePct) >= 100 ? Math.round(c.changePct) : c.changePct}%`;
}

/** What the month is compared with: "Oct" for a past month, "Oct 1–4" early in the current one. */
export function periodLabel(d: Pick<Dashboard, "comparedTo" | "previousMonth">): string {
  const { from, to } = d.comparedTo;
  const prev = monthLabel(d.previousMonth, "short");
  const full = Number(to.slice(8)) === new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate();
  return full ? prev : `${prev} 1–${Number(to.slice(8))}`;
}

/** A KPI delta: arrow, signed text, and whether that direction is good. */
export function delta(v: number | null | undefined, upIsGood: boolean, unit: "pct" | "pts" = "pct"): { text: string; good: boolean | null } | null {
  if (v === null || v === undefined) return null;
  const flat = Math.abs(v) < 0.5;
  if (flat) return { text: "→ same", good: null };
  const body = unit === "pts" ? `${v > 0 ? "+" : ""}${v} pts` : `${v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? ">999" : v}%`;
  return { text: `${v > 0 ? "▲" : "▼"} ${body}`, good: v > 0 === upIsGood };
}

/** The month as a transactions filter range. */
export function monthRange(d: Pick<Dashboard, "month" | "spendingByDay">): { from: string; to: string } {
  return { from: `${d.month}-01`, to: `${d.month}-${String(d.spendingByDay.length).padStart(2, "0")}` };
}

/** Filters the Transactions tab takes (src/lib/transaction-filters.ts) for a tapped item. */
export type FilterLink = { category?: string; uncategorized?: boolean; accountId?: string; status?: "pending"; q?: string; from?: string; to?: string };

export type AttentionItem = { key: string; text: string; link: FilterLink | "import" | "reimburse" };

export function attentionItems(d: Pick<Dashboard, "attention" | "month" | "today" | "spendingByDay">): AttentionItem[] {
  const a = d.attention;
  const range = monthRange(d);
  const items: AttentionItem[] = [];
  if (a.uncategorizedThisMonth > 0) {
    items.push({ key: "unc", text: `${plural(a.uncategorizedThisMonth, "uncategorized transaction")} in ${monthLabel(d.month, "short")}`, link: { uncategorized: true, ...range } });
  }
  if (a.uncategorizedAll > a.uncategorizedThisMonth) items.push({ key: "unc-all", text: `${a.uncategorizedAll} uncategorized in total`, link: { uncategorized: true } });
  if (a.pending > 0) items.push({ key: "pending", text: `${plural(a.pending, "quick add")} waiting for a statement`, link: { status: "pending" } });
  if (a.pendingStale > 0) {
    const cutoff = addDays(d.today, -(a.pendingStaleDays + 1));
    const them = a.pendingStale === 1 ? "it" : "them";
    items.push({
      key: "stale",
      text: `${plural(a.pendingStale, "pending quick add")} older than ${a.pendingStaleDays} days: no statement confirmed ${them}. Import the statement, or fix or delete ${them}`,
      link: { status: "pending", to: cutoff },
    });
  }
  // Absent in a dashboard cached before the server had reimbursements.
  const rb = a.reimburse;
  if (rb && rb.draft + rb.submitted > 0) {
    const parts = [rb.draft ? `${rb.draft} not claimed yet` : null, rb.submitted ? `${rb.submitted} waiting for the company` : null].filter(Boolean).join(", ");
    items.push({ key: "reimburse", text: `${rb.owed.display} to be reimbursed (diganti kantor): ${parts}`, link: "reimburse" });
  }
  for (const s of a.staleAccounts) {
    items.push(
      s.lastDate
        ? { key: s.id, text: `${s.name}: nothing recorded for ${s.daysSince} days (last ${s.lastDate}). Import a newer statement?`, link: { accountId: s.id } }
        : { key: s.id, text: `${s.name}: no transactions yet. Import a statement`, link: "import" },
    );
  }
  return items;
}

// ---- chart geometry ----

/** SVG path of a donut segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const end = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const pt = (r: number, a: number) => `${round(cx + r * Math.sin(a))} ${round(cy - r * Math.cos(a))}`;
  return [`M ${pt(rOuter, a0)}`, `A ${rOuter} ${rOuter} 0 ${large} 1 ${pt(rOuter, end)}`, `L ${pt(rInner, end)}`, `A ${rInner} ${rInner} 0 ${large} 0 ${pt(rInner, a0)}`, "Z"].join(" ");
}

/** Start and end angles per value, with a small gap between segments (none for a single one). */
export function donutAngles(values: number[], gap = 0.02): { a0: number; a1: number }[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (!(total > 0)) return values.map(() => ({ a0: 0, a1: 0 }));
  const g = values.filter((v) => v > 0).length > 1 ? gap : 0;
  let at = 0;
  return values.map((v) => {
    const span = (Math.max(0, v) / total) * Math.PI * 2;
    const seg = { a0: at + g / 2, a1: at + Math.max(span - g / 2, g / 2) };
    at += span;
    return seg;
  });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
