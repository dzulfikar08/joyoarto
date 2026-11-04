// Joyo AI in the browser: safe links in answers, the member's own key (this browser only), and the starter prompts.

const SAFE_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

/** A link target that is safe to put in an `href` (http, https, mailto), else null. From JoyoRogo's joyo-chat.ts. */
export function safeHref(href: string): string | null {
  return href.length <= 2048 && SAFE_URL.test(href) ? href : null;
}

export type ByokProvider = "anthropic" | "openrouter" | "openai";

/**
 * The member's own API key. Kept in this browser's localStorage only and sent with each question over HTTPS; the
 * server uses it for that one call and never stores or logs it. `enabled` false keeps the key but uses JoyoArto's model.
 */
export type ByokSettings = { provider: ByokProvider; apiKey: string; model: string; enabled: boolean };

const BYOK_KEY = "baroka.joyo.byok";

export function loadByok(): ByokSettings | null {
  try {
    const raw = localStorage.getItem(BYOK_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ByokSettings>;
    if ((v.provider !== "anthropic" && v.provider !== "openrouter" && v.provider !== "openai") || typeof v.apiKey !== "string") return null;
    return { provider: v.provider, apiKey: v.apiKey, model: typeof v.model === "string" ? v.model : "", enabled: v.enabled !== false };
  } catch {
    return null;
  }
}

export function saveByok(settings: ByokSettings | null): void {
  try {
    if (settings) localStorage.setItem(BYOK_KEY, JSON.stringify(settings));
    else localStorage.removeItem(BYOK_KEY);
  } catch {
    // Private mode: the key lasts for this page only.
  }
}

/** The key as the request sends it, or undefined for JoyoArto's own model. */
export function byokInput(settings: ByokSettings | null) {
  if (!settings?.enabled || settings.apiKey.trim().length < 10) return undefined;
  return { provider: settings.provider, apiKey: settings.apiKey.trim(), ...(settings.model.trim() ? { model: settings.model.trim() } : {}) };
}

export const STARTERS: readonly { text: string; hint: string }[] = [
  { text: "Berapa pengeluaran makan bulan ini?", hint: "Spending by category" },
  { text: "Aman nggak beli mobil Geely EX2 Max Juni 2027?", hint: "Plan & simulate" },
  { text: "What did we spend the most on last month?", hint: "Top categories and merchants" },
  { text: "Ada transaksi yang belum dikategorikan? Bantu rapikan.", hint: "Categorise with rules" },
  { text: "Bandingkan cashflow 6 bulan terakhir", hint: "Income, spending, savings rate" },
  { text: "Are we on track with our budgets?", hint: "Budget pace" },
];
