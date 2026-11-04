// Joyo AI on the phone: starter prompts, the "reading …" words for tools, the member's own API key, and what the
// composer shows when Joyo is off or today's questions are used up. Mirrors apps/web/src/lib/joyo.ts and
// components/joyo/*. Pure, unit-tested; the key's secure storage is src/lib/joyo-byok.ts.

import type { ByokInput } from "./joyo-stream";
import { isUpgradeError } from "./errors";

export const STARTERS: readonly { text: string; hint: string }[] = [
  { text: "Berapa pengeluaran makan bulan ini?", hint: "Spending by category" },
  { text: "Aman nggak beli mobil Geely EX2 Max Juni 2027?", hint: "Plan & simulate" },
  { text: "What did we spend the most on last month?", hint: "Top categories and merchants" },
  { text: "Ada transaksi yang belum dikategorikan? Bantu rapikan.", hint: "Categorise with rules" },
  { text: "Bandingkan cashflow 6 bulan terakhir", hint: "Income, spending, savings rate" },
  { text: "Are we on track with our budgets?", hint: "Budget pace" },
];

export const MAX_CHARS = 4_000;

const TOOL_WORDS: Record<string, string> = {
  list_accounts: "Accounts and balances",
  list_categories: "Categories",
  search_transactions: "Transactions",
  spending_summary: "Spending summary",
  cashflow: "Monthly cashflow",
  month_dashboard: "Month overview",
  budget_status: "Budgets",
  plan_baseline: "Planning baseline",
  plan_templates: "Plan templates",
  simulate_plan: "Simulation",
  compare_plans: "Plan comparison",
  list_scenarios: "Saved scenarios",
  household_info: "Household",
  list_rules: "Rules",
  list_imports: "Imports",
  quick_add: "Proposed: add",
  categorize: "Proposed: categorise",
  update_transaction: "Proposed: edit",
  create_rule: "Proposed: rule",
  set_budget: "Proposed: budget",
  save_scenario: "Proposed: save scenario",
};

export const toolWords = (tool: string) => TOOL_WORDS[tool] ?? tool;

/** "month: 2026-11 · category: food" (up to four plain arguments, never the cursor). */
export function argLine(args: Record<string, string | number | boolean>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "cursor")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

/** The chip over an answer: "Reading budgets…" while a tool runs, then "Read 3 sources". */
export function stepsLabel(steps: readonly { tool: string; running?: boolean }[], streaming: boolean): string | null {
  if (!steps.length) return null;
  const last = steps.at(-1)!;
  if (streaming && steps.some((s) => s.running)) return `Reading ${toolWords(last.tool).toLowerCase()}…`;
  return `Read ${steps.length} ${steps.length === 1 ? "source" : "sources"}`;
}

// ------------------------------------------------------------------------------------------------ the member's key

export type ByokProvider = ByokInput["provider"];
export const BYOK_PROVIDERS: readonly ByokProvider[] = ["anthropic", "openrouter", "openai"];

/**
 * The member's own API key. On the phone it is kept in the secure store (Android Keystore / iOS Keychain), never in
 * the query cache or a file, and sent with each question over HTTPS; the server uses it for that one call and never
 * stores or logs it. `enabled` false keeps the key but uses JoyoArto's model. Removed at sign-out.
 */
export type ByokSettings = { provider: ByokProvider; apiKey: string; model: string; enabled: boolean };

export function parseByok(raw: string | null): ByokSettings | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ByokSettings>;
    if (!BYOK_PROVIDERS.includes(v.provider as ByokProvider) || typeof v.apiKey !== "string" || !v.apiKey.trim()) return null;
    return { provider: v.provider as ByokProvider, apiKey: v.apiKey, model: typeof v.model === "string" ? v.model : "", enabled: v.enabled !== false };
  } catch {
    return null;
  }
}

/** The key as the request sends it, or undefined for JoyoArto's own model. */
export function byokInput(settings: ByokSettings | null): ByokInput | undefined {
  if (!settings?.enabled || settings.apiKey.trim().length < 10) return undefined;
  return { provider: settings.provider, apiKey: settings.apiKey.trim(), ...(settings.model.trim() ? { model: settings.model.trim() } : {}) };
}

/** "sk-ant-…a1b2": enough to recognise the key, never the whole of it on screen. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return "•".repeat(k.length);
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

// ------------------------------------------------------------------------------------------------ off and cap

export type JoyoStatusLike = {
  hosted: { provider: string; model: string } | null;
  usedToday: number;
  dailyCap: number;
  plan: "free" | "pro";
};

export type Availability =
  | { kind: "loading" }
  | { kind: "ready"; subtitle: string }
  | { kind: "off"; message: string }
  | { kind: "cap"; message: string };

/**
 * Whether the composer is open, and what it says when it is not. `storeSafe` (iOS): never a word about buying more
 * (App Review 3.1.1); the web's "get more with Pro" link has no counterpart on either phone (no purchases in the app yet).
 */
export function availability(status: JoyoStatusLike | undefined, usage: { usedToday: number; dailyCap: number } | null, byok: ByokSettings | null, storeSafe: boolean): Availability {
  const key = byokInput(byok);
  if (key) return { kind: "ready", subtitle: `Your ${key.provider} key${key.model ? ` · ${key.model}` : ""}` };
  if (!status) return { kind: "loading" };
  if (!status.hosted) return { kind: "off", message: "Joyo AI is off on this server. Add your own API key to use it." };
  const used = Math.max(status.usedToday, usage?.usedToday ?? 0);
  const cap = usage?.dailyCap ?? status.dailyCap;
  if (cap > 0 && used >= cap) {
    const more = !storeSafe && status.plan === "free" ? " Joyo Pro raises the daily limit." : "";
    return { kind: "cap", message: `That's all of today's ${cap} questions. They come back tomorrow (WIB), or use your own API key.${more}` };
  }
  return { kind: "ready", subtitle: `${status.hosted.model}${cap > 0 ? ` · ${used}/${cap} today` : ""}` };
}

/** A failed question as the chat shows it. The Free cap on iOS gets a neutral line (no "Joyo Pro … JoyoRogo"). */
export function chatErrorMessage(e: unknown, base: string, storeSafe: boolean): string {
  if (storeSafe && isUpgradeError(e)) {
    const reason = (e as { data?: { reason?: unknown } }).data?.reason;
    if (reason === "cap") return "That's all of today's Joyo AI questions. They come back tomorrow (WIB), or use your own API key.";
  }
  return base;
}

const SAFE_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

/** A link target in an answer that is safe to open (http, https, mailto), else null. */
export function safeHref(href: string): string | null {
  return href.length <= 2048 && SAFE_URL.test(href) ? href : null;
}
