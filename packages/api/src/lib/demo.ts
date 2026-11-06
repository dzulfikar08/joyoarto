// The demo account for store reviewers (Google Play, later the App Store) and screenshots: one fixed user in one fixed
// household full of made-up data (services/demo.ts). Fixed ids, so "is this the demo?" needs no query.

import { ORPCError } from "@orpc/server";

export const DEMO_USER_ID = "demo-reviewer";
export const DEMO_HOUSEHOLD_ID = "demo-household";
/** `.invalid` is reserved (RFC 2606): no mail can ever reach it, and no real person can sign in with it. */
export const DEMO_EMAIL = "reviewer@demo.joyoarto.invalid";
export const DEMO_NAME = "Demo Reviewer";
export const DEMO_HOUSEHOLD_NAME = "Keluarga Demo";
/** How long the `brk_` token the phone app gets from a demo code lasts. */
export const DEMO_TOKEN_DAYS = 7;

export function isDemoUser(userId: string | null | undefined): boolean {
  return userId === DEMO_USER_ID;
}

/**
 * Things the demo account may not do: anything that reaches real people or outlives the daily reset. AI connections
 * (OAuth) are allowed for reviewers of Claude's connectors directory and last DEMO_TOKEN_DAYS (apps/server/src/mcp.ts).
 */
export type DemoRestricted = "invite" | "acceptInvite" | "leaveHousehold" | "deleteHousehold" | "deleteAccount" | "longLivedToken" | "emailImport";

const WHAT: Record<DemoRestricted, string> = {
  invite: "invite people",
  acceptInvite: "join another household",
  leaveHousehold: "leave its household",
  deleteHousehold: "delete its household",
  deleteAccount: "delete the account",
  longLivedToken: "create API tokens that last longer than a day",
  emailImport: "import statements by email",
};

/** Throws FORBIDDEN (data.demo) when the caller is the demo user. */
export function refuseDemo(userId: string, action: DemoRestricted): void {
  if (!isDemoUser(userId)) return;
  throw new ORPCError("FORBIDDEN", {
    message: `The demo account cannot ${WHAT[action]}. Its data is made up and resets every day; sign in with Google to use JoyoArto for real.`,
    data: { demo: true, action },
  });
}

/** Compares a code typed by a reviewer with DEMO_LOGIN_CODE in constant time (both hashed first). Unset = off. */
export async function demoCodeMatches(code: string, expected: string | null | undefined): Promise<boolean> {
  const want = expected?.trim();
  if (!want) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s.trim())));
  const [a, b] = await Promise.all([digest(code), digest(want)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
