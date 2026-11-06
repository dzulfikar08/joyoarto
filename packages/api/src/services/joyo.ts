// Joyo AI conversations: private to the member who wrote them, kept per household (the active one), so a member in two
// households sees each household's chats there. Every read and write checks both the user and the household.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import { chunk } from "../lib/d1";
import { sealJson, sealText, unsealJson, unsealText } from "../lib/data-key";
import type { Proposal, Step } from "../lib/joyo-ai/tools";
import { notFound } from "./common";

const c = schema.joyoConversation;
const m = schema.joyoMessage;

/** Kept per member and household; the oldest go when a new one would pass this. */
export const MAX_CONVERSATIONS = 50;
/** Messages kept per conversation (the model only ever reads the last 16 turns). */
export const MAX_MESSAGES = 200;

export const conversationIdInput = z.object({ id: z.string().min(1).max(64) });

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  proposals: Proposal[];
  model: string | null;
  createdAt: Date;
};

function titleOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

function own(p: Principal) {
  return and(eq(c.userId, p.userId), eq(c.householdId, p.householdId));
}

export async function listConversations(db: Database, p: Principal) {
  const rows = await db.select({ id: c.id, title: c.title, updatedAt: c.updatedAt }).from(c).where(own(p)).orderBy(desc(c.updatedAt)).limit(MAX_CONVERSATIONS);
  return { conversations: await Promise.all(rows.map(async (r) => ({ ...r, title: await unsealText(r.title) }))) };
}

export async function getConversationRow(db: Database, p: Principal, id: string) {
  const [row] = await db.select().from(c).where(and(own(p), eq(c.id, id)));
  return row ? { ...row, title: await unsealText(row.title) } : notFound("Conversation");
}

/** content, steps and proposals are sealed at rest (DATA_KEY); this opens them. */
async function toStored(r: typeof m.$inferSelect): Promise<StoredMessage> {
  return {
    id: r.id,
    role: r.role,
    content: await unsealText(r.content),
    steps: ((await unsealJson(r.steps)) as Step[] | null) ?? [],
    proposals: ((await unsealJson(r.proposals)) as Proposal[] | null) ?? [],
    model: r.model,
    createdAt: r.createdAt,
  };
}

export async function getConversation(db: Database, p: Principal, id: string) {
  const conv = await getConversationRow(db, p, id);
  const rows = await db.select().from(m).where(eq(m.conversationId, id)).orderBy(asc(m.createdAt), asc(m.id));
  return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, messages: await Promise.all(rows.map(toStored)) };
}

export async function deleteConversation(db: Database, p: Principal, id: string) {
  await getConversationRow(db, p, id);
  await db.delete(c).where(and(own(p), eq(c.id, id)));
  return { id, deleted: true };
}

/** A new conversation titled after its first message. The oldest beyond {@link MAX_CONVERSATIONS} are deleted. */
export async function createConversation(db: Database, p: Principal, firstMessage: string) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(c).values({ id, householdId: p.householdId, userId: p.userId, title: await sealText(titleOf(firstMessage) || "Chat"), createdAt: now, updatedAt: now });
  const extra = await db.select({ id: c.id }).from(c).where(own(p)).orderBy(desc(c.updatedAt)).limit(1000).offset(MAX_CONVERSATIONS);
  for (const ids of chunk(extra.map((r) => r.id), 90)) await db.delete(c).where(inArray(c.id, ids));
  return id;
}

export async function appendMessage(
  db: Database,
  conversationId: string,
  msg: { role: "user" | "assistant"; content: string; steps?: Step[]; proposals?: Proposal[]; model?: string },
): Promise<StoredMessage> {
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    conversationId,
    role: msg.role,
    content: msg.content,
    steps: msg.steps?.length ? msg.steps : null,
    proposals: msg.proposals?.length ? msg.proposals : null,
    model: msg.model ?? null,
    createdAt: now,
  };
  await db.insert(m).values({ ...row, content: await sealText(row.content), steps: await sealJson(row.steps), proposals: await sealJson(row.proposals) });
  await db.update(c).set({ updatedAt: now }).where(eq(c.id, conversationId));
  return toStored(row);
}

/** The turns the model reads next, oldest first (the newest {@link MAX_MESSAGES}). */
export async function historyOf(db: Database, conversationId: string): Promise<StoredMessage[]> {
  const rows = await db.select().from(m).where(eq(m.conversationId, conversationId)).orderBy(desc(m.createdAt), desc(m.id)).limit(MAX_MESSAGES);
  return Promise.all(rows.reverse().map(toStored));
}

/** One message of the member's own conversation, with its conversation. */
export async function ownMessage(db: Database, p: Principal, messageId: string) {
  const [row] = await db
    .select({ message: m })
    .from(m)
    .innerJoin(c, eq(c.id, m.conversationId))
    .where(and(eq(m.id, messageId), own(p)));
  return row?.message ? toStored(row.message) : notFound("Message");
}

export async function saveProposals(db: Database, messageId: string, proposals: Proposal[]) {
  await db.update(m).set({ proposals: await sealJson(proposals) }).where(eq(m.id, messageId));
}

const hm = schema.householdMember;

export const joyoSettingsInput = z.object({
  readOnly: z.boolean().describe("Joyo AI only reads: it is offered no changes to propose, and confirming an older proposal is refused"),
});

/** The member's Joyo AI settings in the active household. */
export async function getJoyoSettings(db: Database, p: Principal) {
  const [row] = await db
    .select({ readOnly: hm.joyoReadOnly })
    .from(hm)
    .where(and(eq(hm.householdId, p.householdId), eq(hm.userId, p.userId)));
  return { readOnly: row?.readOnly ?? false };
}

export async function setJoyoSettings(db: Database, p: Principal, input: z.infer<typeof joyoSettingsInput>) {
  const res = await db
    .update(hm)
    .set({ joyoReadOnly: input.readOnly })
    .where(and(eq(hm.householdId, p.householdId), eq(hm.userId, p.userId)))
    .returning({ readOnly: hm.joyoReadOnly });
  if (!res.length) notFound("Membership");
  return { readOnly: res[0]!.readOnly };
}
