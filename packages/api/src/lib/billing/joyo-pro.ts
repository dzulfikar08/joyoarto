// Joyo Pro lives on JoyoRogo's server: one subscription per account, shared by JoyoRogo, JoyoFit and JoyoArto. This is
// the client for the two calls JoyoArto makes, plus the pure rules for caching the answer.
//
//   POST {JOYOROGO_API_URL}/api/internal/joyo-pro/status   header x-joyo-internal-key: <JOYO_INTERNAL_KEY>
//        body { googleSub?, email }  ->  { pro, until, plan, source }   (401 = wrong key)
//   GET  {JOYOROGO_API_URL}/api/config                       public: the current prices, so they never drift
//
// Both apps sign in with the same Google OAuth client, so the Google account id (better-auth account.accountId for
// providerId "google") identifies the person; the verified email is the fallback.

import { z } from "zod";

import type { JoyoProConfig } from "./config";

export const JOYO_PRO_STATUS_PATH = "/api/internal/joyo-pro/status";
export const JOYO_INTERNAL_KEY_HEADER = "x-joyo-internal-key";
const TIMEOUT_MS = 3_000;

/** How long an answer is trusted before asking again. */
export const PRO_CACHE_MS = 10 * 60_000;
export const FREE_CACHE_MS = 2 * 60_000;
/** While JoyoRogo is unreachable, a user stays Pro this long past the last end it confirmed. Never for a never-Pro user. */
export const FAIL_OPEN_MS = 24 * 60 * 60_000;

export const JOYO_PRO_PLANS = ["monthly", "yearly", "lifetime"] as const;
export type JoyoProPlan = (typeof JOYO_PRO_PLANS)[number];

export type JoyoProAnswer = { pro: boolean; until: Date | null; plan: JoyoProPlan | null; source: string | null };

/** JoyoRogo refused the key (401): a configuration problem, never the user's fault. */
export class JoyoProUnauthorized extends Error {
  constructor() {
    super("JoyoRogo refused JOYO_INTERNAL_KEY (401): set the same secret on both servers");
  }
}

/** Timeout, network error, 5xx or an unreadable answer. */
export class JoyoProUnavailable extends Error {}

const answerSchema = z.object({
  pro: z.boolean(),
  until: z.string().nullish(),
  plan: z.string().nullish(),
  source: z.string().nullish(),
});

/** Asks JoyoRogo whether this person has Joyo Pro. Throws JoyoProUnauthorized or JoyoProUnavailable. */
export async function fetchJoyoPro(
  config: JoyoProConfig,
  who: { googleSub: string | null; email: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JoyoProAnswer> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.apiUrl}${JOYO_PRO_STATUS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [JOYO_INTERNAL_KEY_HEADER]: config.key },
      body: JSON.stringify({ ...(who.googleSub ? { googleSub: who.googleSub } : {}), email: who.email }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new JoyoProUnavailable(`joyo-pro status: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (res.status === 401 || res.status === 403) throw new JoyoProUnauthorized();
  if (!res.ok) throw new JoyoProUnavailable(`joyo-pro status: HTTP ${res.status}`);
  const parsed = answerSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new JoyoProUnavailable("joyo-pro status: unreadable answer");
  const until = parsed.data.until ? new Date(parsed.data.until) : null;
  if (until && Number.isNaN(until.getTime())) throw new JoyoProUnavailable("joyo-pro status: bad until");
  const plan = JOYO_PRO_PLANS.find((p) => p === parsed.data.plan) ?? null;
  return { pro: parsed.data.pro, until, plan, source: parsed.data.source ?? null };
}

// ------------------------------------------------------------------------------------------------ cache rules

/** The cached row (joyo_pro_status), as far as these rules need it. */
export type CachedJoyoPro = {
  pro: boolean;
  until: Date | null;
  plan: string | null;
  source: string | null;
  checkedAt: Date;
  expiresAt: Date;
  lastProUntil: Date | null;
  lastProLifetime: boolean;
};

/** Pro right now according to an answer: a Pro answer whose end has passed is not Pro any more. */
export function answerIsPro(a: { pro: boolean; until: Date | null }, now: Date): boolean {
  return a.pro && (a.until === null || a.until.getTime() > now.getTime());
}

/** The row to store for a fresh answer. Keeps the latest Pro end ever confirmed, for the fail-open window. */
export function cacheRow(answer: JoyoProAnswer, previous: Pick<CachedJoyoPro, "lastProUntil" | "lastProLifetime"> | undefined, now: Date): CachedJoyoPro {
  const pro = answerIsPro(answer, now);
  let lastProUntil = previous?.lastProUntil ?? null;
  if (pro && answer.until && (!lastProUntil || answer.until.getTime() > lastProUntil.getTime())) lastProUntil = answer.until;
  return {
    pro: answer.pro,
    until: answer.until,
    plan: answer.plan,
    source: answer.source,
    checkedAt: now,
    expiresAt: new Date(now.getTime() + (pro ? PRO_CACHE_MS : FREE_CACHE_MS)),
    lastProUntil,
    // A not-Pro answer ends a lifetime grant (revoked): fail-open must not bring it back.
    lastProLifetime: pro && answer.until === null ? true : pro ? (previous?.lastProLifetime ?? false) : false,
  };
}

/**
 * JoyoRogo did not answer: Pro only for someone it once confirmed, and at most 24 h past the last end it confirmed (a
 * lifetime grant stays). Someone who was never Pro gets nothing.
 */
export function failOpen(cached: CachedJoyoPro | undefined, now: Date): { pro: boolean; until: Date | null } {
  if (!cached) return { pro: false, until: null };
  if (cached.lastProLifetime) return { pro: true, until: null };
  if (cached.lastProUntil && now.getTime() < cached.lastProUntil.getTime() + FAIL_OPEN_MS) return { pro: true, until: cached.lastProUntil };
  return { pro: false, until: null };
}

// ------------------------------------------------------------------------------------------------ prices

/** JoyoRogo's current Joyo Pro prices, from its public /api/config. Whole rupiah; cents/sen for the card prices. */
export type JoyoPricing = {
  idr: { monthly: number; yearly: number };
  /** "X slots left at this price, then Rp Y"; null once the ladder's open step is reached. */
  promo: { slots: number; taken: number; nextPriceIdr: number | null } | null;
  usdCents: { monthly: number; yearly: number } | null;
  myrSen: { monthly: number; yearly: number } | null;
  sgdCents: { monthly: number; yearly: number } | null;
};

const positive = z.number().int().positive();
const configSchema = z.object({
  founderPriceIdr: positive,
  founderYearlyPriceIdr: positive,
  promo: z.object({ slots: positive, taken: z.number().int().min(0), nextPriceIdr: positive.nullish() }).nullish(),
  usd: z.object({ monthlyCents: positive, yearlyCents: positive }).nullish(),
  myr: z.object({ monthlySen: positive, yearlySen: positive }).nullish(),
  sgd: z.object({ monthlyCents: positive, yearlyCents: positive }).nullish(),
});

/** Reads JoyoRogo's public prices. Throws JoyoProUnavailable. */
export async function fetchJoyoPricing(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<JoyoPricing> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl}/api/config`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new JoyoProUnavailable(`joyorogo config: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) throw new JoyoProUnavailable(`joyorogo config: HTTP ${res.status}`);
  const parsed = configSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new JoyoProUnavailable("joyorogo config: no prices in the answer");
  const c = parsed.data;
  return {
    idr: { monthly: c.founderPriceIdr, yearly: c.founderYearlyPriceIdr },
    promo: c.promo && c.promo.slots > c.promo.taken ? { slots: c.promo.slots, taken: c.promo.taken, nextPriceIdr: c.promo.nextPriceIdr ?? null } : null,
    usdCents: c.usd ? { monthly: c.usd.monthlyCents, yearly: c.usd.yearlyCents } : null,
    myrSen: c.myr ? { monthly: c.myr.monthlySen, yearly: c.myr.yearlySen } : null,
    sgdCents: c.sgd ? { monthly: c.sgd.monthlyCents, yearly: c.sgd.yearlyCents } : null,
  };
}
