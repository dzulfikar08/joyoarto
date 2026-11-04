// Billing settings from wrangler vars and secrets. Prices are placeholders until the owner confirms them.
//
// Limits are enforced only when PAYWALL=1 AND at least one gateway (DOKU or Polar) has credentials, as in JoyoRogo:
// a self-host without billing, or the hosted server before its secrets are set, never shows upgrade prompts nobody
// could act on.

import type { BillingInterval } from "@baroka/db/schema/billing";

import { DOKU_PRODUCTION_URL, DOKU_SANDBOX_URL } from "./doku";
import type { DokuConfig } from "./doku";
import { POLAR_PRODUCTION_URL, POLAR_SANDBOX_URL } from "./polar";
import type { PolarConfig } from "./polar";

export type BillingEnv = {
  /** "1" turns the Free limits on (needs a configured gateway too). */
  PAYWALL?: string;
  /** Whole rupiah. Placeholders: Rp 29.000 a month, Rp 290.000 a year. */
  PRO_MONTHLY_IDR?: string;
  PRO_YEARLY_IDR?: string;
  /** Founder (early-bird) price for the first PRO_FOUNDER_SLOTS paying households; they keep it on renewal. Empty = no founder offer. */
  PRO_FOUNDER_MONTHLY_IDR?: string;
  PRO_FOUNDER_YEARLY_IDR?: string;
  PRO_FOUNDER_SLOTS?: string;
  /** Days of Pro a new household gets (default 14, "0" = none). */
  PRO_TRIAL_DAYS?: string;
  /** Households created before this day (YYYY-MM-DD, WIB) are Pro until PRO_GRANDFATHER_UNTIL. */
  PRO_GRANDFATHER_CREATED_BEFORE?: string;
  PRO_GRANDFATHER_UNTIL?: string;
  /** Comma-separated emails whose households are always Pro (the owner); ADMIN_EMAILS count too. */
  PRO_EMAILS?: string;
  ADMIN_EMAILS?: string;
  /** Secrets: DOKU Checkout client id and secret key. */
  DOKU_CLIENT_ID?: string;
  DOKU_SECRET_KEY?: string;
  /** "production" talks to api.doku.com; anything else (the default) is the sandbox. */
  DOKU_ENV?: string;
  /** Secrets: Polar organization access token and webhook secret. */
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  /** "production" talks to api.polar.sh; anything else (the default) is the sandbox. */
  POLAR_SERVER?: string;
  POLAR_PRODUCT_MONTHLY_ID?: string;
  POLAR_PRODUCT_YEARLY_ID?: string;
  /** Displayed USD prices in cents (keep equal to the Polar products). Placeholders: $2.99 and $29. */
  POLAR_PRICE_MONTHLY_USD_CENTS?: string;
  POLAR_PRICE_YEARLY_USD_CENTS?: string;
};

export type PriceIdr = Record<BillingInterval, number>;

export type BillingConfig = {
  /** Free limits apply. False: every household gets Pro (self-host, or billing not set up yet). */
  enforced: boolean;
  /** Whole rupiah. */
  priceIdr: PriceIdr;
  founder: { priceIdr: PriceIdr; slots: number } | null;
  trialDays: number;
  grandfather: { createdBefore: Date; until: Date } | null;
  /** Lowercased. */
  proEmails: string[];
  doku: DokuConfig | null;
  polar: PolarConfig | null;
  /** Public web app origin, for return URLs (no trailing slash). */
  appUrl: string;
  /** Public API origin, for the DOKU notification URL. */
  apiUrl: string;
};

export const DEFAULT_PRICE_IDR: PriceIdr = { monthly: 29_000, yearly: 290_000 };
export const DEFAULT_PRICE_USD_CENTS: Record<BillingInterval, number> = { monthly: 299, yearly: 2900 };
export const DEFAULT_TRIAL_DAYS = 14;

function whole(name: string, raw: string | undefined, fallback: number, min = 1): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min) {
    // Loud on purpose: a typo must not silently sell Pro at the wrong price.
    throw new Error(`${name} must be a whole number >= ${min}, got "${raw}"`);
  }
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
  return lists.flatMap((l) => (l ?? "").split(",")).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function dokuConfig(env: BillingEnv): DokuConfig | null {
  const clientId = env.DOKU_CLIENT_ID?.trim();
  const secretKey = env.DOKU_SECRET_KEY?.trim();
  if (!clientId || !secretKey) return null;
  const production = env.DOKU_ENV?.trim() === "production";
  return { clientId, secretKey, baseUrl: production ? DOKU_PRODUCTION_URL : DOKU_SANDBOX_URL, sandbox: !production };
}

/** Null until the token, webhook secret and both product ids are set: USD checkout stays off. */
export function polarConfig(env: BillingEnv): PolarConfig | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  const monthly = env.POLAR_PRODUCT_MONTHLY_ID?.trim();
  const yearly = env.POLAR_PRODUCT_YEARLY_ID?.trim();
  if (!accessToken || !webhookSecret || !monthly || !yearly) return null;
  return {
    accessToken,
    webhookSecret,
    baseUrl: env.POLAR_SERVER?.trim() === "production" ? POLAR_PRODUCTION_URL : POLAR_SANDBOX_URL,
    productIds: { monthly, yearly },
    priceUsdCents: {
      monthly: whole("POLAR_PRICE_MONTHLY_USD_CENTS", env.POLAR_PRICE_MONTHLY_USD_CENTS, DEFAULT_PRICE_USD_CENTS.monthly),
      yearly: whole("POLAR_PRICE_YEARLY_USD_CENTS", env.POLAR_PRICE_YEARLY_USD_CENTS, DEFAULT_PRICE_USD_CENTS.yearly),
    },
  };
}

export function billingConfig(env: BillingEnv, urls: { appUrl: string; apiUrl: string }): BillingConfig {
  const doku = dokuConfig(env);
  const polar = polarConfig(env);
  const monthly = whole("PRO_MONTHLY_IDR", env.PRO_MONTHLY_IDR, DEFAULT_PRICE_IDR.monthly);
  const yearly = whole("PRO_YEARLY_IDR", env.PRO_YEARLY_IDR, monthly * 10);
  const founderMonthly = env.PRO_FOUNDER_MONTHLY_IDR?.trim();
  const founder = founderMonthly
    ? {
        priceIdr: {
          monthly: whole("PRO_FOUNDER_MONTHLY_IDR", founderMonthly, 0),
          yearly: whole("PRO_FOUNDER_YEARLY_IDR", env.PRO_FOUNDER_YEARLY_IDR, Number(founderMonthly) * 10),
        },
        slots: whole("PRO_FOUNDER_SLOTS", env.PRO_FOUNDER_SLOTS, 100),
      }
    : null;
  const gfBefore = env.PRO_GRANDFATHER_CREATED_BEFORE?.trim();
  const gfUntil = env.PRO_GRANDFATHER_UNTIL?.trim();
  return {
    enforced: env.PAYWALL?.trim() === "1" && (doku !== null || polar !== null),
    priceIdr: { monthly, yearly },
    founder,
    trialDays: whole("PRO_TRIAL_DAYS", env.PRO_TRIAL_DAYS, DEFAULT_TRIAL_DAYS, 0),
    grandfather:
      gfBefore && gfUntil ? { createdBefore: wibDay("PRO_GRANDFATHER_CREATED_BEFORE", gfBefore), until: wibDay("PRO_GRANDFATHER_UNTIL", gfUntil) } : null,
    proEmails: emails(env.PRO_EMAILS, env.ADMIN_EMAILS),
    doku,
    polar,
    appUrl: urls.appUrl.replace(/\/+$/, ""),
    apiUrl: urls.apiUrl.replace(/\/+$/, ""),
  };
}
