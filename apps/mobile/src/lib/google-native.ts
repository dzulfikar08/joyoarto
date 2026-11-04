// Native Google Sign-In (ported from JoyoRogo apps/native/src/lib/google-native.ts): Google's own account sheet (Play
// services on Android, the GoogleSignIn SDK on iOS) returns an ID token, which goes to better-auth. No browser.
//
// Client ids (all in the Google Cloud project `joyorogo`, docs/mobile-auth.md):
// - Android: the token's audience is the web client id the app passes as `webClientId` (= the server's
//   GOOGLE_CLIENT_ID). The Android OAuth clients (package com.joyodigitama.joyoarto + signing SHA-1) only identify the
//   app to Google; without one for the signing key, Google answers DEVELOPER_ERROR (code 10).
// - iOS: the token's audience is the iOS client id; the server lists it in GOOGLE_NATIVE_CLIENT_IDS. The app needs the
//   reversed client id as a URL scheme (app.config.ts adds it when the id is configured).
//
// This file is pure (no React Native imports) so the outcome mapping is unit-tested.

export const DEVELOPER_ERROR_CODE = "10";

export type NativeGoogleToken =
  | { status: "ok"; idToken: string }
  | { status: "cancelled" }
  /** Native sign-in cannot work on this install (no Play services, signing key not registered, not configured). */
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

export type NativeStatusCodes = { SIGN_IN_CANCELLED: string; PLAY_SERVICES_NOT_AVAILABLE: string };

export type SignInOutcome = { kind: "signed-in" } | { kind: "cancelled" } | { kind: "unavailable"; message: string } | { kind: "failed"; message: string };

export type NativeGoogleDeps = {
  /** False when the build has no native module or no client id for this platform. */
  available: () => boolean;
  requestIdToken: () => Promise<NativeGoogleToken>;
  /** Posts the ID token to the server and stores the session; throws with a user-facing message. */
  exchange: (idToken: string) => Promise<void>;
  log?: (message: string) => void;
};

function errorCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null || !("code" in e)) return undefined;
  const code = (e as { code: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
}

function errorText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 160);
}

/** Maps what the native module throws to one of the token outcomes. */
export function classifyNativeGoogleError(e: unknown, codes?: NativeStatusCodes): NativeGoogleToken {
  const code = errorCode(e);
  const reason = `${code ?? "no code"} ${errorText(e)}`;
  if (codes && code === codes.SIGN_IN_CANCELLED) return { status: "cancelled" };
  if (code === DEVELOPER_ERROR_CODE) return { status: "unavailable", reason: `developer error: ${reason}` };
  if (codes && code === codes.PLAY_SERVICES_NOT_AVAILABLE) return { status: "unavailable", reason: `Play services unavailable: ${reason}` };
  return { status: "failed", reason };
}

export const GOOGLE_UNAVAILABLE_MESSAGE =
  "Google sign-in isn't available in this build of the app yet. Sign in with a token from JoyoArto on the web, or try the demo.";

/** Runs the native sheet, then the exchange. Never throws. */
export async function signInWithNativeGoogle(deps: NativeGoogleDeps): Promise<SignInOutcome> {
  const log = deps.log ?? (() => undefined);
  if (!deps.available()) return { kind: "unavailable", message: GOOGLE_UNAVAILABLE_MESSAGE };
  const token = await deps.requestIdToken();
  if (token.status === "cancelled") return { kind: "cancelled" };
  if (token.status === "unavailable") {
    log(`[google] native sign-in unavailable: ${token.reason}`);
    return { kind: "unavailable", message: GOOGLE_UNAVAILABLE_MESSAGE };
  }
  if (token.status === "failed") {
    log(`[google] native sign-in failed: ${token.reason}`);
    return { kind: "failed", message: `Google sign-in failed (${token.reason.slice(0, 100)}).` };
  }
  try {
    await deps.exchange(token.idToken);
    return { kind: "signed-in" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[google] server rejected the ID token: ${message}`);
    return { kind: "failed", message };
  }
}
