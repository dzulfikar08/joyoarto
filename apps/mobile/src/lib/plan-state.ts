// Plan & simulate on the phone: the page's state (baseline overrides and up to six scenarios), how it becomes the
// plan.compare and plan.scenarios.save inputs, and the form fields' text <-> value mapping. Ported from the web's
// apps/web/src/lib/plan-state.ts and routes/plan.tsx with the same block shape, so a scenario saved on the phone opens
// with its blocks (a baby as one block) on the web and the other way round. The draft is kept on this phone only
// (src/lib/plan-draft.ts), per household. Pure, unit-tested.

import type { AccountRole, ScenarioItemInput } from "@baroka/api/lib/plan/schema";
import { babyTemplate, carTemplate, carUpgradeTemplate } from "@baroka/api/lib/plan/templates";

import { shiftMonth } from "./format";

export type { AccountRole, ScenarioItemInput };

export type LoanIn = Extract<ScenarioItemInput, { type: "loan" }>;
export type OneOffIn = Extract<ScenarioItemInput, { type: "oneOff" }>;
export type RecurringIn = Extract<ScenarioItemInput, { type: "recurring" }>;
export type IncomeChangeIn = Extract<ScenarioItemInput, { type: "incomeChange" }>;
export type PlainIn = OneOffIn | RecurringIn | IncomeChangeIn;
export type SaleIn = NonNullable<LoanIn["sale"]>;

export type BabyBlock = { key: string; kind: "baby"; birthMonth: string; caesar: boolean; caregiver: boolean; items: ScenarioItemInput[] };
export type Block = { key: string; kind: "loan"; item: LoanIn } | BabyBlock | { key: string; kind: "item"; item: PlainIn };

export type Scenario = {
  id: string;
  name: string;
  /** Colour slot 1–6 (theme.viz.series), kept when other scenarios are removed. */
  slot: number;
  blocks: Block[];
  /** The saved scenario this card was saved as or opened from. */
  savedId?: string;
  /** signature() when last saved or opened: a different one means unsaved changes. */
  savedSig?: string;
};

export type SavedView = { v: 1; blocks: Block[] };

export type PlanState = {
  v: 1;
  monthlyIncome?: number;
  monthlySpending?: number;
  existingInstallments?: number;
  roles: Record<string, AccountRole>;
  horizonMonths: number;
  scenarios: Scenario[];
};

export const EMPTY_PLAN: PlanState = { v: 1, roles: {}, horizonMonths: 36, scenarios: [] };
export const MAX_SCENARIOS = 6;
export const HORIZONS = [12, 24, 36, 48, 60, 120] as const;
export const TENORS = [12, 24, 36, 48, 60, 72, 84] as const;

export const ROLE_LABEL: Record<AccountRole, string> = { emergency: "Emergency", goal: "Goal", spending: "Spending", exclude: "Not counted" };
export const ROLES = Object.keys(ROLE_LABEL) as AccountRole[];
export const FUNDED = [
  ["goal", "Goal savings"],
  ["spending", "Spending accounts"],
  ["emergency", "Emergency fund"],
] as const;

export const uid = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------------------------------------ scenarios

export function flatten(s: Pick<Scenario, "blocks">): ScenarioItemInput[] {
  return s.blocks.flatMap((b) => (b.kind === "baby" ? b.items : [b.item]));
}

/** The lowest colour slot (1–6) no other scenario uses. */
export function freeSlot(scenarios: Scenario[]): number {
  for (let i = 1; i <= MAX_SCENARIOS; i++) if (!scenarios.some((s) => s.slot === i)) return i;
  return (scenarios.length % MAX_SCENARIOS) + 1;
}

export function carBlock(month: string, label: string, price = 0): Block {
  return { key: uid(), kind: "loan", item: carTemplate({ month, price, label }).items[0] as LoanIn };
}

/** Small car now, sold after `sellAfterMonths`, then a bigger one: two loan blocks. */
export function upgradeBlocks(month: string, sellAfterMonths = 18): Block[] {
  return carUpgradeTemplate({ month, sellAfterMonths }).items.map((item) => ({ key: uid(), kind: "loan" as const, item: item as LoanIn }));
}

export function babyBlock(birthMonth: string, caesar = false, caregiver = false): BabyBlock {
  return { key: uid(), kind: "baby", birthMonth, caesar, caregiver, items: babyTemplate({ birthMonth, caesar, caregiver }).items };
}

/** Caesarean / caregiver switched: the template again (edited amounts reset, as on the web). */
export function regenerateBaby(b: BabyBlock, caesar: boolean, caregiver: boolean): BabyBlock {
  return { ...b, caesar, caregiver, items: babyTemplate({ birthMonth: b.birthMonth, caesar, caregiver }).items };
}

const monthsBetween = (a: string, b: string) => {
  const [y1, m1] = a.split("-").map(Number) as [number, number];
  const [y2, m2] = b.split("-").map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
};

/** Moves every month in a baby block by the same number of months, keeping edited amounts. */
export function shiftBaby(b: BabyBlock, birthMonth: string): BabyBlock {
  const by = monthsBetween(b.birthMonth, birthMonth);
  const mv = (m?: string) => (m ? shiftMonth(m, by) : m);
  return {
    ...b,
    birthMonth,
    items: b.items.map((i) => (i.type === "oneOff" ? { ...i, month: mv(i.month) } : i.type === "loan" ? i : { ...i, startMonth: mv(i.startMonth), endMonth: mv(i.endMonth) })),
  };
}

export const newOneOff = (start: string): Block => ({ key: uid(), kind: "item", item: { type: "oneOff", label: "One-off cost", month: start, amount: 0, direction: "out", fundedFrom: "spending" } });
export const newRecurring = (start: string): Block => ({ key: uid(), kind: "item", item: { type: "recurring", label: "Monthly cost", startMonth: start, monthly: 0 } });
export const newIncomeChange = (start: string): Block => ({ key: uid(), kind: "item", item: { type: "incomeChange", label: "Income change", startMonth: start, mode: "delta", amount: 0 } });

/** "Car A", "Car B"... by how many loans the scenario has. */
export const nextCarLabel = (s: Pick<Scenario, "blocks">) => `Car ${String.fromCharCode(65 + s.blocks.filter((b) => b.kind === "loan").length)}`;

/** The examples the web offers on an empty page. */
export function quickStart(start: string): Scenario[] {
  const birth = shiftMonth(start, 6);
  return [
    { id: uid(), name: "Car A + baby", slot: 1, blocks: [carBlock(start, "Car A"), babyBlock(birth)] },
    { id: uid(), name: "Car B + baby", slot: 2, blocks: [carBlock(start, "Car B"), babyBlock(birth)] },
    { id: uid(), name: "Baby, no car", slot: 3, blocks: [babyBlock(birth)] },
  ];
}

export const upgradeStart = (start: string): Scenario[] => [{ id: uid(), name: "Small car now, bigger later", slot: 1, blocks: upgradeBlocks(start) }];
export const blankStart = (): Scenario[] => [{ id: uid(), name: "Scenario 1", slot: 1, blocks: [] }];

export function addScenario(st: PlanState): PlanState {
  if (st.scenarios.length >= MAX_SCENARIOS) return st;
  return { ...st, scenarios: [...st.scenarios, { id: uid(), name: `Scenario ${st.scenarios.length + 1}`, slot: freeSlot(st.scenarios), blocks: [] }] };
}

export function duplicateScenario(st: PlanState, id: string): PlanState {
  const i = st.scenarios.findIndex((s) => s.id === id);
  if (i < 0 || st.scenarios.length >= MAX_SCENARIOS) return st;
  const s = st.scenarios[i]!;
  const copy: Scenario = {
    id: uid(),
    name: `${s.name} (copy)`,
    slot: freeSlot(st.scenarios),
    blocks: s.blocks.map((b) => ({ ...(JSON.parse(JSON.stringify(b)) as Block), key: uid() })),
  };
  return { ...st, scenarios: [...st.scenarios.slice(0, i + 1), copy, ...st.scenarios.slice(i + 1)] };
}

export const removeScenario = (st: PlanState, id: string): PlanState => ({ ...st, scenarios: st.scenarios.filter((s) => s.id !== id) });

export const updateScenario = (st: PlanState, id: string, fn: (s: Scenario) => Scenario): PlanState => ({ ...st, scenarios: st.scenarios.map((s) => (s.id === id ? fn(s) : s)) });

export const setBlock = (s: Scenario, key: string, b: Block): Scenario => ({ ...s, blocks: s.blocks.map((x) => (x.key === key ? b : x)) });
export const removeBlock = (s: Scenario, key: string): Scenario => ({ ...s, blocks: s.blocks.filter((x) => x.key !== key) });
export const addBlocks = (s: Scenario, ...blocks: Block[]): Scenario => ({ ...s, blocks: [...s.blocks, ...blocks] });

/** Name and blocks without the per-render keys: what "unsaved changes" compares. */
export function signature(s: Pick<Scenario, "name" | "blocks">): string {
  return JSON.stringify({ name: s.name.trim(), blocks: s.blocks.map(({ key: _key, ...rest }) => rest) });
}

export const isDirty = (s: Scenario) => !!s.savedId && s.savedSig !== signature(s);

/** "Save", "Save changes" or "Saved". */
export const saveLabel = (s: Scenario) => (!s.savedId ? "Save" : isDirty(s) ? "Save changes" : "Saved");

/** A compare scenario's name for a card (an empty name is sent as "Untitled"). */
export const nameOf = (s: Pick<Scenario, "name">) => s.name.trim() || "Untitled";

// ------------------------------------------------------------------------------------------------ server inputs

/** Baseline overrides as the server takes them. */
function overrides(st: PlanState) {
  return {
    ...(st.monthlyIncome !== undefined ? { monthlyIncome: st.monthlyIncome } : {}),
    ...(st.monthlySpending !== undefined ? { monthlySpending: st.monthlySpending } : {}),
    ...(st.existingInstallments !== undefined ? { existingInstallments: st.existingInstallments } : {}),
    roles: st.roles,
    horizonMonths: st.horizonMonths,
  };
}

/** plan.compare's input: every scenario against the same baseline, plus "No change". Null with nothing to compare. */
export function compareInput(st: PlanState) {
  if (!st.scenarios.length) return null;
  return { ...overrides(st), scenarios: st.scenarios.map((s) => ({ name: nameOf(s), items: flatten(s) })), includeBaseline: true };
}

/** plan.scenarios.save's input for one card. The view keeps the blocks so the web and the phone reopen the same layout. */
export function savePayload(st: PlanState, s: Scenario) {
  return {
    ...(s.savedId ? { id: s.savedId } : {}),
    name: nameOf(s).slice(0, 60),
    plan: { ...overrides(st), items: flatten(s) },
    view: { v: 1, blocks: s.blocks } satisfies SavedView,
  };
}

/** After a save: the card remembers the saved id, and the name the server kept. */
export function markSaved(st: PlanState, scenarioId: string, saved: { id: string; name: string }): PlanState {
  return updateScenario(st, scenarioId, (x) => ({ ...x, name: saved.name, savedId: saved.id, savedSig: signature({ name: saved.name, blocks: x.blocks }) }));
}

/** A saved scenario was deleted: cards opened from it become unsaved drafts. */
export function markDeleted(st: PlanState, savedId: string): PlanState {
  return { ...st, scenarios: st.scenarios.map((x) => (x.savedId === savedId ? { ...x, savedId: undefined, savedSig: undefined } : x)) };
}

function validView(x: unknown): x is SavedView {
  return !!x && typeof x === "object" && (x as SavedView).v === 1 && Array.isArray((x as SavedView).blocks);
}

/** The blocks of a saved scenario: its saved layout when there is one, else one block per item (saved by Claude). */
export function blocksFromSaved(items: ScenarioItemInput[], view: unknown): Block[] {
  if (validView(view)) return view.blocks.map((b) => ({ ...b, key: uid() }));
  return items.map((item) => (item.type === "loan" ? { key: uid(), kind: "loan", item } : { key: uid(), kind: "item", item: item as PlainIn }));
}

export type SavedPlan = {
  id: string;
  name: string;
  plan: { items: ScenarioItemInput[]; monthlyIncome?: number; monthlySpending?: number; existingInstallments?: number; roles?: Record<string, AccountRole>; horizonMonths?: number };
  view: unknown;
};

const hasOwnBaseline = (p: { monthlyIncome?: number; monthlySpending?: number; existingInstallments?: number; roles?: Record<string, unknown> }) =>
  p.monthlyIncome !== undefined || p.monthlySpending !== undefined || p.existingInstallments !== undefined || Object.keys(p.roles ?? {}).length > 0;

/**
 * Adds a saved scenario as a card. The page's baseline wins when it has its own numbers (every card shares one
 * baseline); else the saved one's numbers come along. `keptPageBaseline`: both had their own, say so.
 */
export function openSaved(st: PlanState, sc: SavedPlan): { ok: false; reason: string } | { ok: true; state: PlanState; keptPageBaseline: boolean } {
  if (st.scenarios.length >= MAX_SCENARIOS) return { ok: false, reason: "Six scenarios at most on the page; remove one first." };
  const blocks = blocksFromSaved(sc.plan.items, sc.view);
  const p = sc.plan;
  const pageHasOwn = hasOwnBaseline(st);
  const savedHasOwn = hasOwnBaseline(p);
  const state: PlanState = {
    ...st,
    ...(!pageHasOwn && savedHasOwn ? { monthlyIncome: p.monthlyIncome, monthlySpending: p.monthlySpending, existingInstallments: p.existingInstallments, roles: p.roles ?? {} } : {}),
    ...(!st.scenarios.length && p.horizonMonths ? { horizonMonths: p.horizonMonths } : {}),
    scenarios: [...st.scenarios, { id: uid(), name: sc.name, slot: freeSlot(st.scenarios), blocks, savedId: sc.id, savedSig: signature({ name: sc.name, blocks }) }],
  };
  return { ok: true, state, keptPageBaseline: pageHasOwn && savedHasOwn };
}

// ------------------------------------------------------------------------------------------------ baseline

export type BaselineLike = {
  income: { recurring: { amount: number } };
  spending: { monthly: { amount: number } };
  existingInstallments: { monthly: { amount: number } };
  accounts: { id: string; suggestedRole: AccountRole; balance: { amount: number } }[];
};

/** The numbers the plan runs on: the page's overrides, else the ledger's. */
export function effectiveBaseline(b: BaselineLike, st: PlanState) {
  const income = st.monthlyIncome ?? b.income.recurring.amount;
  const spending = st.monthlySpending ?? b.spending.monthly.amount;
  const existing = st.existingInstallments ?? b.existingInstallments.monthly.amount;
  const totals = { emergency: 0, goal: 0, spending: 0 };
  for (const a of b.accounts) {
    const r = st.roles[a.id] ?? a.suggestedRole;
    if (r !== "exclude") totals[r] += a.balance.amount;
  }
  const edited = st.monthlyIncome !== undefined || st.monthlySpending !== undefined || st.existingInstallments !== undefined || Object.keys(st.roles).length > 0;
  return { income, spending, existing, free: income - spending - existing, totals, edited, empty: b.income.recurring.amount === 0 && b.spending.monthly.amount === 0 };
}

/** Choosing the suggested role removes the override, so the ledger's suggestion keeps following the ledger. */
export function setRole(st: PlanState, accountId: string, role: AccountRole, suggested: AccountRole): PlanState {
  const roles = { ...st.roles };
  if (role === suggested) delete roles[accountId];
  else roles[accountId] = role;
  return { ...st, roles };
}

export const resetBaseline = (st: PlanState): PlanState => ({ ...st, monthlyIncome: undefined, monthlySpending: undefined, existingInstallments: undefined, roles: {} });

// ------------------------------------------------------------------------------------------------ form fields

/** Rupiah minor units to what the field shows: whole rupiah with thousands dots ("1.500.000"); empty = not set. */
export function moneyText(minor: number | undefined): string {
  if (minor === undefined) return "";
  return Math.round(Math.abs(minor) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** What was typed to minor units: digits only (dots, spaces, "Rp" ignored); empty = undefined. */
export function parseMoneyText(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits.slice(0, 15)) * 100 : undefined;
}

/** A number field's text ("2,5" with an Indonesian comma reads as 2.5). Empty = undefined; junk = null (keep editing). */
export function parseNumText(text: string): number | undefined | null {
  const t = text.trim().replace(",", ".");
  if (!t) return undefined;
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return null;
  return Number(t);
}

export const numText = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** The usual tenors plus the loan's own when a quote uses another (the Geely's 47 months). */
export const tenorChoices = (current: number): number[] => (TENORS.includes(current as (typeof TENORS)[number]) ? [...TENORS] : [...TENORS, current].sort((a, b) => a - b));

/** Years a month picker offers: last year to ten years out, widened to include the current value. */
export function yearChoices(thisMonth: string, value?: string): number[] {
  const thisYear = Number(thisMonth.slice(0, 4));
  const year = value ? Number(value.slice(0, 4)) : thisYear;
  const first = Math.min(thisYear - 1, year);
  const last = Math.max(thisYear + 10, year);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export const monthOf = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

// Loan fields that exclude each other, as the web's editor sets them.

/** Down payment as a percentage: the amount is cleared. */
export const setDownPaymentPct = (l: LoanIn, pct: number | undefined): LoanIn => ({ ...l, downPaymentPct: pct === undefined ? undefined : clamp(pct, 0, 100), downPayment: undefined });

/** Down payment as an amount: the percentage is cleared (empty brings the percentage back into use). */
export const setDownPayment = (l: LoanIn, amount: number | undefined): LoanIn => ({ ...l, downPayment: amount, ...(amount === undefined ? {} : { downPaymentPct: undefined }) });

/** A quoted installment replaces the rate; clearing it with no rate set falls back to 0% so the loan stays valid. */
export const setInstallment = (l: LoanIn, amount: number | undefined): LoanIn => ({ ...l, installment: amount, ...(amount === undefined && l.ratePct === undefined ? { ratePct: 0 } : {}) });

/** The down payment amount the field hints at when only a percentage is set. */
export const downPaymentHint = (l: LoanIn): number | undefined => (l.price ? Math.round((l.price * (l.downPaymentPct ?? 0)) / 100) : undefined);

/** The percentage the field hints at when an amount is set. */
export const downPaymentPctHint = (l: LoanIn): number | undefined => (l.downPayment !== undefined && l.price ? Math.round((l.downPayment / l.price) * 1000) / 10 : undefined);

/** Selling it later: on with 18 months, off clears the terms. */
export const toggleSale = (l: LoanIn, on: boolean): LoanIn => ({ ...l, sale: on ? { afterMonths: 18 } : undefined });

export function patchSale(l: LoanIn, patch: Partial<SaleIn>): LoanIn {
  const s = l.sale;
  return { ...l, sale: { afterMonths: s?.afterMonths ?? 18, ...s, ...patch } };
}

/** Resale as a percentage clears an amount, and the other way round. */
export const setResalePct = (l: LoanIn, pct: number | undefined) => patchSale(l, { resalePct: pct === undefined ? undefined : clamp(pct, 0, 100), resaleAmount: undefined });

/** An income change's amount keeps its sign; `negative` is the ± toggle. */
export const signedAmount = (abs: number | undefined, negative: boolean) => (negative ? -1 : 1) * (abs ?? 0);

export const flipSign = (i: IncomeChangeIn): IncomeChangeIn => ({ ...i, amount: -i.amount });

/** One line under a baby cost: "once, 2027-05" or "monthly from 2027-05, rising to Rp 800.000". */
export function itemWhen(it: ScenarioItemInput, rp: (minor: number) => string): string {
  if (it.type === "oneOff") return `once, ${it.month ?? "start"}`;
  if (it.type === "recurring") return `monthly from ${it.startMonth ?? "start"}${it.endMonth ? ` to ${it.endMonth}` : ""}${it.rampTo ? `, rising to ${rp(it.rampTo)}` : ""}`;
  return "";
}

// ------------------------------------------------------------------------------------------------ results

export type VerdictKind = "comfortable" | "tight" | "risky";

export const VERDICT: Record<VerdictKind, { label: string; icon: "checkmark-circle" | "alert-circle" | "close-circle"; tone: "positive" | "warning" | "destructive" }> = {
  comfortable: { label: "Comfortable", icon: "checkmark-circle", tone: "positive" },
  tight: { label: "Tight", icon: "alert-circle", tone: "warning" },
  risky: { label: "Risky", icon: "close-circle", tone: "destructive" },
};

export function plainVerdict(v: VerdictKind, lowestDisplay: string): string {
  if (v === "comfortable") return `This looks affordable on these numbers: every check passes and your liquid money stays above ${lowestDisplay}.`;
  if (v === "tight") return "Possible, but with little room for surprises. The points below are where it gets thin.";
  return "On these numbers this plan puts you at real risk. The points below say why; try a cheaper option, a bigger down payment from other savings, a longer tenor or a later date.";
}

/** The card's colour slot for a compare scenario by name; null = "No change" (drawn dashed, in the previous colour). */
export function slotOf(name: string, scenarios: Scenario[]): number | null {
  return scenarios.find((s) => nameOf(s) === name)?.slot ?? null;
}

/** Scenario names repeated on the page: the compare result can't tell them apart, so the screen asks to rename. */
export function duplicateNames(scenarios: Scenario[]): string[] {
  const seen = new Map<string, number>();
  for (const s of scenarios) seen.set(nameOf(s), (seen.get(nameOf(s)) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}

/** Thins month labels for a narrow chart: every nth month so about `max` show. */
export function tickMonths(months: string[], max = 5): string[] {
  if (months.length <= max) return months;
  const step = Math.ceil(months.length / max);
  return months.filter((_, i) => i % step === 0);
}

// ------------------------------------------------------------------------------------------------ the draft on the phone

export type PlanDraft = { v: 1; householdId: string; state: PlanState };

function validState(x: unknown): x is PlanState {
  return !!x && typeof x === "object" && (x as PlanState).v === 1 && Array.isArray((x as PlanState).scenarios) && typeof (x as PlanState).roles === "object";
}

/** The stored draft, only for the household it was made in (roles are account ids of that household). */
export function draftFor(raw: unknown, householdId: string | null | undefined): PlanState {
  const d = raw as Partial<PlanDraft> | null;
  if (!householdId || !d || d.v !== 1 || d.householdId !== householdId || !validState(d.state)) return EMPTY_PLAN;
  return { ...d.state, scenarios: d.state.scenarios.slice(0, MAX_SCENARIOS) };
}
