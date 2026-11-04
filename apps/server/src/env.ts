import type { BillingEnv } from "@baroka/api/lib/billing/config";
import { env as workerEnv } from "cloudflare:workers";

export type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** JoyoArto Pro billing vars and secrets are listed in BillingEnv (packages/api/src/lib/billing/config.ts). */
export type Env = BillingEnv & {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  APP_URL?: string;
  CORS_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
  ALLOWED_EMAILS?: string;
  MCP_LIMITER?: RateLimit;
  OAUTH_REGISTER_LIMITER?: RateLimit;
  WAITLIST_LIMITER?: RateLimit;
  /** Comma-separated emails that may read the waitlist. */
  ADMIN_EMAILS?: string;
  /** Domain of the household import addresses (import+<token>@<domain>, Email Routing to this Worker). Unset = off. */
  IMPORT_EMAIL_DOMAIN?: string;
  /** Workers AI: Whisper for voice notes, and Joyo AI's fallback model when ANTHROPIC_API_KEY is not set. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** Secret. JoyoArto's Anthropic key for Joyo AI and capture parsing. Unset = Workers AI fallback (or off). */
  ANTHROPIC_API_KEY?: string;
  /** Optional: a Cloudflare AI Gateway URL ending in /anthropic, for logging, caching and spend limits. */
  ANTHROPIC_BASE_URL?: string;
  /** Joyo AI chat model (default claude-opus-5-5). */
  JOYO_AI_MODEL?: string;
  /** Capture parsing model (default claude-opus-5-5). */
  JOYO_PARSE_MODEL?: string;
  /** low | medium | high (default medium). */
  JOYO_AI_EFFORT?: string;
  /** Workers AI chat model when there is no Anthropic key. */
  JOYO_WORKERS_AI_MODEL?: string;
  /** Hosted Joyo AI questions per member per WIB day (default 30; "0" turns the hosted chat off). */
  JOYO_AI_DAILY_CAP?: string;
  /** Voice notes plus AI parses per member per day (default 60). */
  JOYO_CAPTURE_DAILY_CAP?: string;
};

export const env = workerEnv as unknown as Env;
