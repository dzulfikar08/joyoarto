// Daily caps of the AI features, counted from the ai_usage ledger per member and WIB day (the same pattern as JoyoRogo's
// server-limit.ts). A slot is taken BEFORE the model runs, in one statement, so concurrent calls cannot all slip under
// the cap; the row keeps counts and tokens only, never text.

import type { Database } from "@baroka/db";
import { schema } from "@baroka/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/** Joyo AI chat limits. Here (a module without imports from the router) so routers/joyo.ts can read them at load time. */
export const CHAT_LIMITS = {
  /** Turns of history sent with a question. */
  turns: 16,
  messageChars: 4_000,
  /** Older answers are cut to this: they were read already, and every token is paid again on each question. */
  oldAnswerChars: 1_500,
  toolRounds: 6,
  toolCallsPerRound: 6,
  /** Answer budget per call (the Claude adapter adds room for adaptive thinking). */
  maxTokens: 3_000,
  deadlineMs: 120_000,
} as const;

export type UsageKind = "chat" | "transcribe" | "parse";
export type UsageEngine = "hosted" | "byok";

const WIB_MS = 7 * 3_600_000;

/** Start of the WIB day of `now`, as epoch ms. */
export function wibDayStart(now = Date.now()): number {
  return Math.floor((now + WIB_MS) / 86_400_000) * 86_400_000 - WIB_MS;
}

/** A cap from a wrangler var: unset or garbage = the default, "0" = off, at most 1000. */
export function capFrom(raw: string | undefined, fallback: number): number {
  const t = raw?.trim();
  if (!t) return fallback;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return Math.min(n, 1000);
}

export async function usedToday(db: Database, userId: string, kinds: readonly UsageKind[], engine: UsageEngine, now = Date.now()): Promise<number> {
  const u = schema.aiUsage;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(u)
    .where(and(eq(u.userId, userId), eq(u.engine, engine), gte(u.createdAt, new Date(wibDayStart(now))), inArray(u.kind, [...kinds])));
  return row?.n ?? 0;
}

/** Takes one of today's slots, or returns null when the day is full. `kinds` share one cap (transcribe + parse). */
export async function reserveSlot(
  db: Database,
  slot: { userId: string; householdId: string; kind: UsageKind; kinds?: readonly UsageKind[]; engine: UsageEngine; model: string; cap: number },
  now = Date.now(),
): Promise<string | null> {
  const id = crypto.randomUUID();
  const kinds = slot.kinds ?? [slot.kind];
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO ai_usage (id, user_id, household_id, kind, engine, model, outcome, calls, input_tokens, output_tokens, latency_ms, created_at)
    SELECT ${id}, ${slot.userId}, ${slot.householdId}, ${slot.kind}, ${slot.engine}, ${slot.model}, 'pending', 0, 0, 0, 0, ${now}
    WHERE (
      SELECT count(*) FROM ai_usage
      WHERE user_id = ${slot.userId} AND engine = ${slot.engine} AND kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)}) AND created_at >= ${wibDayStart(now)}
    ) < ${slot.cap}
    RETURNING id
  `);
  return rows.length === 1 ? id : null;
}

/** Records how a reserved call went. The slot stays taken whatever happens here. */
export async function settleSlot(
  db: Database,
  id: string,
  result: { outcome: string; calls: number; inputTokens: number; outputTokens: number; latencyMs: number; model?: string },
): Promise<void> {
  const u = schema.aiUsage;
  await db
    .update(u)
    .set({
      outcome: result.outcome.slice(0, 40),
      calls: result.calls,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      ...(result.model ? { model: result.model } : {}),
    })
    .where(eq(u.id, id));
}
