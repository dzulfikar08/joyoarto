import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { SCOPES, isScope } from "../context";
import { ensureHousehold } from "../lib/household";
import { sha256Hex } from "../lib/members";
import type { Principal, Scope } from "../context";
import { notFound } from "./common";

const k = schema.apiToken;
export const TOKEN_PREFIX = "brk_";

function randomToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  // 40 bytes mod 62 has a negligible bias for a 238-bit token.
  return TOKEN_PREFIX + Array.from(bytes, (b) => alphabet[b % 62]).join("");
}

export const createTokenInput = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1).default(["finance:read", "finance:write"]),
  expiresInDays: z.number().int().min(1).max(3650).optional().describe("Default: never expires"),
});

/** Tokens act as their owner. Only an interactive session may mint one, so a token cannot mint more tokens. */
export async function createToken(db: Database, p: Principal, input: z.infer<typeof createTokenInput>) {
  const token = randomToken();
  const row = {
    id: crypto.randomUUID(),
    userId: p.userId,
    name: input.name,
    prefix: token.slice(0, 10),
    tokenHash: await sha256Hex(token),
    scopes: [...new Set(input.scopes)].join(" "),
    expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
  };
  await db.insert(k).values(row);
  return { id: row.id, name: row.name, token, scopes: input.scopes, expiresAt: row.expiresAt, note: "Shown once. Store it now." };
}

export async function listTokens(db: Database, p: Principal) {
  const rows = await db
    .select({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, createdAt: k.createdAt })
    .from(k)
    .where(and(eq(k.userId, p.userId), isNull(k.revokedAt)))
    .orderBy(desc(k.createdAt));
  return { tokens: rows.map((r) => ({ ...r, readOnly: !r.scopes.split(" ").includes("finance:write") })) };
}

export async function revokeToken(db: Database, p: Principal, id: string) {
  const res = await db
    .update(k)
    .set({ revokedAt: new Date() })
    .where(and(eq(k.id, id), eq(k.userId, p.userId), isNull(k.revokedAt)))
    .returning({ id: k.id });
  if (!res.length) notFound(`Token ${id}`);
  return { revoked: id };
}

/** The owner and scopes of a bearer token, or null. Touches lastUsedAt at most once a minute. */
export async function verifyToken(db: Database, token: string): Promise<{ userId: string; scopes: Scope[] } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db.select().from(k).where(eq(k.tokenHash, await sha256Hex(token)));
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(k).set({ lastUsedAt: new Date() }).where(eq(k.id, row.id));
  }
  return { userId: row.userId, scopes: row.scopes.split(" ").filter(isScope) };
}

/** The principal a `brk_` token speaks for (REST, RPC, /mcp): the token's user, in their active household. */
export async function principalFromToken(db: Database, bearer: string): Promise<Principal | null> {
  const token = await verifyToken(db, bearer);
  if (!token) return null;
  return { userId: token.userId, householdId: await ensureHousehold(db, token.userId), scopes: token.scopes, via: "token" };
}
