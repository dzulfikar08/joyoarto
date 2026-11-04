import { SCOPES } from "@baroka/api/context";
import type { Principal } from "@baroka/api/context";
import { ensureHousehold } from "@baroka/api/lib/household";
import { principalFromToken } from "@baroka/api/services/tokens";
import { schema } from "@baroka/db";
import { eq } from "drizzle-orm";

import { getAuth, getDb } from "./services";

/**
 * Who a REST/RPC request speaks for: a `brk_` personal access token in Authorization, else the browser session.
 * OAuth access tokens of AI connections are accepted only at /mcp (apps/server/src/mcp.ts).
 */
export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const db = getDb();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (bearer) return principalFromToken(db, bearer);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return null;
  let householdId: string;
  try {
    householdId = await ensureHousehold(db, session.user.id, session.user.name);
  } catch (error) {
    // The session cookie cache (5 minutes) can outlive a deleted account: treat a user who is gone as signed out.
    const [user] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, session.user.id));
    if (!user) return null;
    throw error;
  }
  return { userId: session.user.id, householdId, scopes: [...SCOPES], via: "session" };
}
