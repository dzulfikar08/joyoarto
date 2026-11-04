// Billing settings from wrangler vars and secrets.
//
// JoyoArto sells nothing itself. Joyo Pro is one subscription per account, bought in JoyoRogo and shared by JoyoRogo,
// JoyoFit and JoyoArto; JoyoRogo's server is the only billing authority. This server only asks it whether a user is Pro
// (joyo-pro.ts), so it holds no payment credentials and receives no payment webhooks.
//
// Free limits apply only with PAYWALL=1 AND JOYO_INTERNAL_KEY set. Without the key (a self-host, or the hosted server
// before the key is in) billing is off and every user gets Pro: JoyoArto is AGPL and free to run yourself.

export type BillingEnv = {
  /** "1" turns the Free limits on (needs JOYO_INTERNAL_KEY too). */
  PAYWALL?: string;
  /** Secret, the same value on JoyoRogo's server: authenticates the Joyo Pro status call. Unset = billing off. */
  JOYO_INTERNAL_KEY?: string;
  /** JoyoRogo's API origin (default https://api.joyorogo.com). */
  JOYOROGO_API_URL?: string;
  /** Where "Upgrade" sends people: JoyoRogo's Pro checkout (default https://app.joyorogo.com/pro). */
  JOYO_PRO_URL?: string;
  /** Days of Pro a new account gets (default 14, "0" = none). */
  PRO_TRIAL_DAYS?: string;
  /** Accounts created before this day (YYYY-MM-DD, WIB) are Pro until PRO_GRANDFATHER_UNTIL. */
  PRO_GRANDFATHER_CREATED_BEFORE?: string;
  PRO_GRANDFATHER_UNTIL?: string;
  /** Comma-separated emails that are always Pro (the owner); ADMIN_EMAILS count too. Passed by deploy.yml, never committed. */
  PRO_EMAILS?: string;
  ADMIN_EMAILS?: string;
};

export type JoyoProConfig = {
  /** JoyoRogo's API origin, no trailing slash. */
  apiUrl: string;
  key: string;
};

export type BillingConfig = {
  /** Free limits apply. False: every user gets Pro (self-host, or billing not set up yet). */
  enforced: boolean;
  /** How to ask JoyoRogo; null = billing off. */
  joyo: JoyoProConfig | null;
  /** JoyoRogo's Pro checkout, with ?from=joyoarto. */
  proUrl: string;
  trialDays: number;
  grandfather: { createdBefore: Date; until: Date } | null;
  /** Lowercased. */
  proEmails: string[];
};

export const DEFAULT_JOYOROGO_API_URL = "https://api.joyorogo.com";
export const DEFAULT_JOYO_PRO_URL = "https://app.joyorogo.com/pro";
export const DEFAULT_TRIAL_DAYS = 14;

function whole(name: string, raw: string | undefined, fallback: number, min = 1): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min) throw new Error(`${name} must be a whole number >= ${min}, got "${raw}"`);
  return Number(value);
}

/** "2026-11-05" as the start of that day in WIB. */
export function wibDay(name: string, raw: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) throw new Error(`${name} must be YYYY-MM-DD, got "${raw}"`);
  const date = new Date(`${raw.trim()}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} is not a real date: "${raw}"`);
  return date;
}

function emails(...lists: (string | undefined)[]): string[] {
  return lists
    .flatMap((l) => (l ?? "").split(","))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function origin(name: string, raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  if (!/^https?:\/\/[^/]+/.test(value)) throw new Error(`${name} must be an http(s) URL, got "${raw}"`);
  return value.replace(/\/+$/, "");
}

/** JoyoRogo's Pro checkout with ?from=joyoarto, so JoyoRogo can tell where the buyer came from. */
export function proCheckoutUrl(base: string): string {
  const url = new URL(base);
  url.searchParams.set("from", "joyoarto");
  return url.toString();
}

export function billingConfig(env: BillingEnv): BillingConfig {
  const key = env.JOYO_INTERNAL_KEY?.trim();
  const joyo = key ? { apiUrl: origin("JOYOROGO_API_URL", env.JOYOROGO_API_URL, DEFAULT_JOYOROGO_API_URL), key } : null;
  const gfBefore = env.PRO_GRANDFATHER_CREATED_BEFORE?.trim();
  const gfUntil = env.PRO_GRANDFATHER_UNTIL?.trim();
  return {
    enforced: env.PAYWALL?.trim() === "1" && joyo !== null,
    joyo,
    proUrl: proCheckoutUrl(origin("JOYO_PRO_URL", env.JOYO_PRO_URL, DEFAULT_JOYO_PRO_URL)),
    trialDays: whole("PRO_TRIAL_DAYS", env.PRO_TRIAL_DAYS, DEFAULT_TRIAL_DAYS, 0),
    grandfather:
      gfBefore && gfUntil
        ? { createdBefore: wibDay("PRO_GRANDFATHER_CREATED_BEFORE", gfBefore), until: wibDay("PRO_GRANDFATHER_UNTIL", gfUntil) }
        : null,
    proEmails: emails(env.PRO_EMAILS, env.ADMIN_EMAILS),
  };
}
