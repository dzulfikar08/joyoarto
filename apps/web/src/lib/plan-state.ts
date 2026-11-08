// The /plan page's state: baseline overrides and scenarios. The page itself is an unsaved draft kept in localStorage
// (per browser) and shareable as a URL hash; scenarios the household wants to keep are saved on the server
// (plan.scenarios), and a card remembers which saved scenario it came from.
import type { AccountRole, ScenarioItemInput } from "@baroka/api/lib/plan/schema";
import { babyTemplate, carTemplate, carUpgradeTemplate } from "@baroka/api/lib/plan/templates";

import { shiftMonth } from "./format";

export type LoanIn = Extract<ScenarioItemInput, { type: "loan" }>;
export type PlainIn = Extract<ScenarioItemInput, { type: "oneOff" | "recurring" | "incomeChange" | "cut" }>;
export type CutIn = Extract<ScenarioItemInput, { type: "cut" }>;

export type Block =
  | { key: string; kind: "loan"; item: LoanIn }
  | { key: string; kind: "baby"; birthMonth: string; caesar: boolean; caregiver: boolean; items: ScenarioItemInput[] }
  | { key: string; kind: "item"; item: PlainIn };

export type Scenario = {
  id: string;
  name: string;
  slot: number;
  blocks: Block[];
  /** The saved scenario this card was saved as or opened from. */
  savedId?: string;
  /** signature() when last saved or opened: a different one means unsaved changes. */
  savedSig?: string;
  /** Turned off: kept on the page but left out of the comparison (and of what Joyo sees). */
  off?: boolean;
};

/** What a saved scenario keeps as `view`, so the page gets its blocks (a baby as one block) back. */
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

const KEY = "baroka.plan.v1";
export const EMPTY: PlanState = { v: 1, roles: {}, horizonMonths: 36, scenarios: [] };

export const uid = () => Math.random().toString(36).slice(2, 10);

export function flatten(s: Scenario): ScenarioItemInput[] {
  return s.blocks.flatMap((b) => (b.kind === "baby" ? b.items : [b.item]));
}

/** The lowest colour slot (1–6) no other scenario uses, so a scenario keeps its colour when others are removed. */
export function freeSlot(scenarios: Scenario[]): number {
  for (let i = 1; i <= 6; i++) if (!scenarios.some((s) => s.slot === i)) return i;
  return (scenarios.length % 6) + 1;
}

export function carBlock(month: string, label: string, price = 0): Block {
  return { key: uid(), kind: "loan", item: carTemplate({ month, price, label }).items[0] as LoanIn };
}

/** Small car now, sold after `sellAfterMonths`, then a bigger one: two loan blocks. */
export function upgradeBlocks(month: string, sellAfterMonths = 18): Block[] {
  return carUpgradeTemplate({ month, sellAfterMonths }).items.map((item) => ({ key: uid(), kind: "loan", item: item as LoanIn }));
}

export function babyBlock(birthMonth: string, caesar = false, caregiver = false): Block {
  return { key: uid(), kind: "baby", birthMonth, caesar, caregiver, items: babyTemplate({ birthMonth, caesar, caregiver }).items };
}

/** Moves every month in a baby block by the same number of months, keeping edited amounts. */
export function shiftBaby(b: Extract<Block, { kind: "baby" }>, birthMonth: string): Block {
  const [y1, m1] = b.birthMonth.split("-").map(Number) as [number, number];
  const [y2, m2] = birthMonth.split("-").map(Number) as [number, number];
  const by = (y2 - y1) * 12 + (m2 - m1);
  const mv = (m?: string) => (m ? shiftMonth(m, by) : m);
  return {
    ...b,
    birthMonth,
    items: b.items.map((i) =>
      i.type === "oneOff" ? { ...i, month: mv(i.month) } : i.type === "loan" ? i : { ...i, startMonth: mv(i.startMonth), endMonth: mv(i.endMonth) },
    ),
  };
}

export function quickStart(start: string): Scenario[] {
  const birth = shiftMonth(start, 6);
  return [
    { id: uid(), name: "Car A + baby", slot: 1, blocks: [carBlock(start, "Car A"), babyBlock(birth)] },
    { id: uid(), name: "Car B + baby", slot: 2, blocks: [carBlock(start, "Car B"), babyBlock(birth)] },
    { id: uid(), name: "Baby, no car", slot: 3, blocks: [babyBlock(birth)] },
  ];
}

function valid(x: unknown): x is PlanState {
  return !!x && typeof x === "object" && (x as PlanState).v === 1 && Array.isArray((x as PlanState).scenarios);
}

export function loadLocal(): PlanState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocal(s: PlanState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or full storage: the plan still works for this visit.
  }
}

/** Name and blocks without the per-render keys: what "unsaved changes" compares. */
export function signature(s: Pick<Scenario, "name" | "blocks">): string {
  return JSON.stringify({ name: s.name.trim(), blocks: s.blocks.map(({ key: _key, ...rest }) => rest) });
}

export const isDirty = (s: Scenario) => !!s.savedId && s.savedSig !== signature(s);

function validView(x: unknown): x is SavedView {
  return !!x && typeof x === "object" && (x as SavedView).v === 1 && Array.isArray((x as SavedView).blocks);
}

/**
 * The blocks of a saved scenario: its saved layout when there is one (the server drops it whenever the items were
 * saved without it, e.g. by Claude), else one block per item.
 */
export function blocksFromSaved(items: ScenarioItemInput[], view: unknown): Block[] {
  if (validView(view)) return view.blocks.map((b) => ({ ...b, key: uid() }));
  return items.map((item) => (item.type === "loan" ? { key: uid(), kind: "loan", item } : { key: uid(), kind: "item", item }));
}

export function encodeShare(s: PlanState): string {
  // Links to saved scenarios mean nothing in someone else's household.
  const shared: PlanState = { ...s, scenarios: s.scenarios.map(({ savedId: _id, savedSig: _sig, ...rest }) => rest) };
  const bytes = new TextEncoder().encode(JSON.stringify(shared));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(hash: string): PlanState | null {
  const m = /plan=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when a saved plan holds something worth asking about before a shared one replaces it. */
export function hasContent(s: PlanState | null): s is PlanState {
  return !!s && (s.scenarios.length > 0 || s.monthlyIncome !== undefined || s.monthlySpending !== undefined || s.existingInstallments !== undefined);
}

/** `local` plus the shared plan's scenarios (fresh ids and colours, at most 6 in all). Baseline overrides stay local. */
export function addSharedScenarios(local: PlanState, shared: PlanState): PlanState {
  const scenarios = [...local.scenarios];
  for (const s of shared.scenarios) {
    if (scenarios.length >= 6) break;
    scenarios.push({ ...structuredClone(s), id: uid(), name: `${s.name || "Untitled"} (shared)`, slot: freeSlot(scenarios) });
  }
  return { ...local, scenarios };
}

// ------------------------------------------------------------------------------------------------ spending cuts

/** Cuts added from "Where to save" carry ids "cut:<habit>", so adding them again replaces them. */
export const isHabitCut = (b: Block) => b.kind === "item" && b.item.type === "cut" && (b.item.id ?? "").startsWith("cut:");

/** A scenario's items without the habit cuts: the plan "Where to save" measures the cuts against. */
export const itemsWithoutCuts = (s: Scenario): ScenarioItemInput[] => flatten({ ...s, blocks: s.blocks.filter((b) => !isHabitCut(b)) });

/**
 * Puts the chosen cuts into scenario `target`, replacing the cuts added before (none chosen: removes them). Without a
 * target (or one that is gone) it adds a scenario holding only the cuts, which compare shows against "No change".
 */
export function applyCuts(st: PlanState, cuts: CutIn[], target: string | null, name: string): { state: PlanState; scenarioId: string | null } {
  const blocks = (): Block[] => cuts.map((item) => ({ key: uid(), kind: "item", item }));
  const at = target ? st.scenarios.find((s) => s.id === target) : undefined;
  if (at) {
    return {
      state: { ...st, scenarios: st.scenarios.map((s) => (s.id === at.id ? { ...s, blocks: [...s.blocks.filter((b) => !isHabitCut(b)), ...blocks()] } : s)) },
      scenarioId: at.id,
    };
  }
  if (!cuts.length || st.scenarios.length >= 6) return { state: st, scenarioId: null };
  const id = uid();
  return { state: { ...st, scenarios: [...st.scenarios, { id, name, slot: freeSlot(st.scenarios), blocks: blocks() }] }, scenarioId: id };
}

// ---------------------------------------------------------------------------------------------------------------
// Joyo AI beside the page

/** What Joyo is told the page shows: the baseline overrides and each scenario's items, as compare_plans takes them. */
export function planPageState(state: PlanState): Record<string, unknown> {
  return {
    ...(state.monthlyIncome !== undefined ? { monthlyIncome: state.monthlyIncome } : {}),
    ...(state.monthlySpending !== undefined ? { monthlySpending: state.monthlySpending } : {}),
    ...(state.existingInstallments !== undefined ? { existingInstallments: state.existingInstallments } : {}),
    ...(Object.keys(state.roles).length ? { roles: state.roles } : {}),
    horizonMonths: state.horizonMonths,
    scenarios: state.scenarios.filter((s) => !s.off).map((s) => ({ name: s.name || "Untitled", items: flatten(s) })),
  };
}

type JoyoPlanArgs = {
  monthlyIncome?: unknown;
  monthlySpending?: unknown;
  existingInstallments?: unknown;
  roles?: unknown;
  horizonMonths?: unknown;
  items?: unknown;
  scenarios?: unknown;
};

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const NO_CHANGE = /^(no change|tanpa perubahan|baseline)$/i;

/**
 * A plan Joyo just ran, applied to the page. compare_plans replaces the page's scenarios with the inline ones it ran
 * (matched by name, so a scenario keeps its colour, saved link and id; empty "No change" ones are left out because the
 * page adds that itself; saved ones by id only are skipped). simulate_plan adds or updates one "Joyo" scenario. Baseline
 * overrides Joyo passed are taken over; the rest of the page stays.
 */
export function applyJoyoPlan(state: PlanState, tool: "compare_plans" | "simulate_plan", raw: Record<string, unknown>, joyoName = "Joyo"): PlanState {
  const args = raw as JoyoPlanArgs;
  const next: PlanState = { ...state };
  if (int(args.monthlyIncome) !== undefined) next.monthlyIncome = int(args.monthlyIncome);
  if (int(args.monthlySpending) !== undefined) next.monthlySpending = int(args.monthlySpending);
  if (int(args.existingInstallments) !== undefined) next.existingInstallments = int(args.existingInstallments);
  if (args.roles && typeof args.roles === "object") next.roles = { ...(args.roles as Record<string, AccountRole>) };
  const h = int(args.horizonMonths);
  if (h !== undefined && h >= 1 && h <= 120) next.horizonMonths = h;

  const incoming: { name: string; items: ScenarioItemInput[] }[] = [];
  if (tool === "compare_plans" && Array.isArray(args.scenarios)) {
    for (const s of args.scenarios as { name?: unknown; items?: unknown }[]) {
      if (typeof s?.name !== "string" || !Array.isArray(s.items)) continue;
      if (!s.items.length && NO_CHANGE.test(s.name.trim())) continue;
      incoming.push({ name: s.name.slice(0, 60), items: s.items as ScenarioItemInput[] });
    }
  } else if (tool === "simulate_plan" && Array.isArray(args.items)) {
    incoming.push({ name: joyoName, items: args.items as ScenarioItemInput[] });
  }
  if (!incoming.length) return next;

  // Joyo never sees turned-off scenarios, so compare_plans keeps them rather than dropping them.
  const kept: Scenario[] = tool === "simulate_plan" ? state.scenarios.filter((s) => s.name !== joyoName) : state.scenarios.filter((s) => s.off);
  const out: Scenario[] = [...kept];
  for (const inc of incoming.slice(0, 6 - kept.length)) {
    const prev = state.scenarios.find((s) => !s.off && (s.name || "Untitled") === inc.name);
    const blocks = blocksFromSaved(inc.items, undefined);
    out.push(prev ? { ...prev, blocks } : { id: uid(), name: inc.name, slot: freeSlot(out), blocks });
  }
  // A matched scenario keeps its slot; make sure no two share one.
  const seen = new Set<number>();
  next.scenarios = out.map((s) => {
    if (!seen.has(s.slot)) {
      seen.add(s.slot);
      return s;
    }
    const slot = [1, 2, 3, 4, 5, 6].find((n) => !seen.has(n) && !out.some((o) => o !== s && o.slot === n)) ?? s.slot;
    seen.add(slot);
    return { ...s, slot };
  });
  return next;
}
