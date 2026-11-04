// Google / Apple sign-in against JoyoArto's better-auth (packages/auth): the app gets an ID token from the platform's
// native sheet and posts it to /api/auth/sign-in/social. The server verifies it (Google: audience = the web client id,
// or the iOS client id in GOOGLE_NATIVE_CLIENT_IDS; Apple: audience = the bundle id), creates or finds the user, and
// answers with a session. Its bearer plugin puts the signed session token in the `set-auth-token` header; the app keeps
// that and sends it as `Authorization: Bearer`. No cookies, no browser. Pure (fetch is injected), unit-tested.

import { ApiError, type FetchLike } from "./api";

export type SocialProvider = "google" | "apple";

export type IdTokenSignIn = {
  server: string;
  provider: SocialProvider;
  idToken: string;
  /** Apple: the raw nonce whose SHA-256 went into the request (better-auth hashes and compares). */
  nonce?: string;
  /** Apple sends the name only on the first authorization, outside the token. */
  name?: { firstName?: string; lastName?: string };
};

const TIMEOUT_MS = 30_000;

export async function exchangeIdToken(input: IdTokenSignIn, fetchImpl: FetchLike = fetch): Promise<{ token: string; userId: string | null }> {
  const base = input.server.replace(/\/+$/, "");
  const body = {
    provider: input.provider,
    idToken: {
      token: input.idToken,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      ...(input.name && (input.name.firstName || input.name.lastName) ? { user: { name: input.name } } : {}),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(controller.signal.aborted ? "The server took too long to answer." : "No connection to the server.", 0);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as { token?: string; user?: { id?: string }; message?: string; code?: string } | null;
  if (!res.ok) throw new ApiError(signInErrorMessage(res.status, json?.code, json?.message), res.status, json?.code);
  // The header carries the signed token; the body's is the raw one, which the bearer plugin signs itself.
  const token = res.headers.get("set-auth-token") ?? json?.token;
  if (!token) throw new ApiError("The server signed you in but sent no session. Update the app or try again.", res.status);
  return { token, userId: json?.user?.id ?? null };
}

/** Revokes a session token on the server. Best effort: signing out on the phone never waits on the network. */
export async function revokeSession(server: string, token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${server.replace(/\/+$/, "")}/api/auth/sign-out`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function signInErrorMessage(status: number, code?: string, message?: string): string {
  // better-auth answers 401 OAUTH_LINK_ERROR with the reason as the message. "unable to create user": the
  // databaseHooks.user.create.before hook said no (invite-only: ALLOWED_EMAILS, no pending invite).
  if (/unable to create user/i.test(message ?? "")) {
    return "This account can't join JoyoArto yet: it is invite-only. Ask a household owner for an invite, then sign in again.";
  }
  if (/account not linked/i.test(message ?? "")) {
    return "This email already has a JoyoArto account with another sign-in method. Use that one (for example Google).";
  }
  if (code === "EMAIL_NOT_VERIFIED") return "Verify this account's email address first, then sign in again.";
  if (status === 401 || code === "INVALID_TOKEN" || code === "ID_TOKEN_NOT_SUPPORTED") {
    return "The server did not accept this sign-in. If it keeps happening, sign in with a token instead.";
  }
  if (status === 404) return "This server does not support Google or Apple sign-in yet.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  return message || `Sign-in failed (server error ${status}).`;
}
