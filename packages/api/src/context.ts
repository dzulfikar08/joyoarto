import type { Database } from "@baroka/db";

import type { BillingConfig } from "./lib/billing/config";

export const SCOPES = ["finance:read", "finance:write"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

/** Who is calling and for which household. Sessions get every scope; tokens and AI connections what they were granted. */
export type Principal = {
  userId: string;
  householdId: string;
  scopes: Scope[];
  /** email: a statement mailed to the household's import address by a member (packages/api/src/services/inbound.ts). */
  via: "session" | "token" | "oauth" | "email";
  /** OAuth client of an AI connection. */
  clientId?: string;
};

/** Facts about the HTTP request that public endpoints need. The server fills it; tests may leave it out. */
export type RequestInfo = {
  /** CF-Connecting-IP when known. Never stored as is. */
  ip: string | null;
  /** Server secret mixed into the IP hash, so stored hashes cannot be reversed by trying every address. */
  ipSalt: string;
  /** Rate limit check: false means over the limit. Absent when the binding is not configured (local dev). */
  allow?: (bucket: "waitlist" | "demo", key: string) => Promise<boolean>;
  /** Lowercased emails of the operators (env ADMIN_EMAILS). */
  adminEmails: string[];
};

/** Server settings procedures need (wrangler vars). Tests may leave it out. */
export type ServerConfig = {
  /** Domain of the household import addresses (import+<token>@<domain>); null = email import off. */
  importEmailDomain: string | null;
  /** DEMO_LOGIN_CODE (secret): the code store reviewers type to reach the demo account. Unset = demo login off. */
  demoCode?: string | null;
};

/** The Workers AI binding (`ai.run(model, input)`), as far as JoyoArto uses it. */
export type AiBinding = { run(model: string, input: unknown): Promise<unknown> };

/**
 * Joyo AI and voice capture settings (wrangler vars and secrets, apps/server/src/env.ts). Absent in tests and when the
 * server has no AI at all: the features then answer "not available".
 */
export type AiConfig = {
  /** ANTHROPIC_API_KEY (secret). Null = hosted chat and parsing fall back to Workers AI, or are off. */
  anthropicKey: string | null;
  /** https://api.anthropic.com, or a Cloudflare AI Gateway URL ending in /anthropic (ANTHROPIC_BASE_URL). */
  anthropicBaseUrl: string;
  /** JOYO_AI_MODEL: the chat model on the hosted engine. */
  chatModel: string;
  /** JOYO_PARSE_MODEL: turns a typed or spoken capture into a draft. */
  parseModel: string;
  /** JOYO_AI_EFFORT: Claude's effort for the chat. */
  effort: "low" | "medium" | "high";
  /** The AI binding (Whisper; chat fallback when there is no Anthropic key). */
  workersAi: AiBinding | null;
  /** JOYO_WORKERS_AI_MODEL: chat model on Workers AI when there is no Anthropic key. */
  workersAiModel: string;
  /** JOYO_VISION_WORKERS_AI_MODEL: reads receipt photos on Workers AI when there is no Anthropic key (default: workersAiModel). */
  visionWorkersAiModel?: string;
  /** Hosted chat messages per member per WIB day (JOYO_AI_DAILY_CAP; 0 = off). */
  dailyCap: number;
  /** Voice notes and parses per member per day (JOYO_CAPTURE_DAILY_CAP). */
  captureCap: number;
  /** DEV_LOGIN only: answer voice notes with a fixed transcript when there is no AI binding (local dev). */
  fakeTranscript: boolean;
  /** Runs work after the response (usage bookkeeping). */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * Private file storage (Cloudflare R2: the RECEIPTS bucket) for receipt photos. Keys start with h/<householdId>/, so a
 * household's files can be listed and deleted together. Absent = photos are off on this server.
 */
export type FileStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  /** Missing keys are ignored. */
  delete(keys: string[]): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor: string | null }>;
};

export type Context = {
  db: Database;
  principal: Principal | null;
  request?: RequestInfo;
  config?: ServerConfig;
  ai?: AiConfig;
  /** JoyoArto Pro billing (apps/server/src/env.ts). Absent = no limits, every household gets Pro (tests, self-hosts). */
  billing?: BillingConfig;
  /** Receipt photos (R2). Absent in most tests and on servers without the bucket. */
  files?: FileStore;
};
