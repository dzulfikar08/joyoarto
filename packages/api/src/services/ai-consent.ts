// Permission to send a member's data to the AI providers (App Review 5.1.1(i) / 5.1.2(i)). Per user, so the web and
// the phone ask once. Nothing reaches an AI before the member allows it:
// - Joyo AI chat, voice notes and receipt photos are refused with PRECONDITION_FAILED `{ aiConsent: true }`; the
//   clients answer that error with the consent sheet.
// - Quick add (typed text) and the statement format spec fall back to the non-AI path instead.
// The demo account's consent is cleared on every demo login (services/demo.ts), so each reviewer is asked.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const AI_CONSENT_MESSAGE = "Allow Joyo AI to read your data first. Nothing is sent to an AI until you allow it.";

export async function aiConsentAt(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db.select({ at: schema.user.aiConsentAt }).from(schema.user).where(eq(schema.user.id, userId));
  return row?.at ?? null;
}

export async function hasAiConsent(db: Database, userId: string): Promise<boolean> {
  return (await aiConsentAt(db, userId)) !== null;
}

/** Throws PRECONDITION_FAILED `{ aiConsent: true }` until the member allows AI. */
export async function requireAiConsent(db: Database, userId: string): Promise<void> {
  if (await hasAiConsent(db, userId)) return;
  throw new ORPCError("PRECONDITION_FAILED", { message: AI_CONSENT_MESSAGE, data: { aiConsent: true } });
}

export const aiConsentInput = z.object({ allow: z.boolean() });

export async function getAiConsent(db: Database, userId: string) {
  const at = await aiConsentAt(db, userId);
  return { allowed: at !== null, at };
}

export async function setAiConsent(db: Database, userId: string, input: z.infer<typeof aiConsentInput>, now = new Date()) {
  const at = input.allow ? now : null;
  await db.update(schema.user).set({ aiConsentAt: at }).where(eq(schema.user.id, userId));
  return { allowed: at !== null, at };
}

/** Whether an ORPC error (or its JSON on the client) is the consent refusal. */
export function isAiConsentError(e: unknown): boolean {
  const data = (e as { data?: { aiConsent?: unknown } } | null)?.data;
  return !!data && data.aiConsent === true;
}
