// Sign in with Apple (iOS only), the way JoyoRogo does it: expo-apple-authentication's sheet with a hashed nonce,
// then the identity token goes to better-auth (`apple` provider, audience = the bundle id, APPLE_BUNDLE_IDS on the
// server). App Store guideline 4.8: an app that offers Google sign-in must offer Sign in with Apple too.

import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { IdTokenSignIn } from "./social-auth";

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

type AppleName = { firstName?: string; lastName?: string };

const PENDING_NAME_KEY = "joyoarto.appleName";

/** The kept name, only for the same Apple ID (credential.user is stable per app). */
async function pendingAppleName(user: string): Promise<AppleName | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_NAME_KEY);
    const v = raw ? (JSON.parse(raw) as AppleName & { user?: string }) : null;
    return v && v.user === user && (v.firstName || v.lastName) ? { firstName: v.firstName || undefined, lastName: v.lastName || undefined } : null;
  } catch {
    return null;
  }
}

/** After a successful Apple sign-in: the server has the name now. */
export function clearPendingAppleName() {
  return SecureStore.deleteItemAsync(PENDING_NAME_KEY).catch(() => undefined);
}

/** The Apple sheet. null = the person closed it. Throws on other failures. */
export async function requestAppleIdToken(): Promise<Omit<IdTokenSignIn, "server"> | null> {
  // Apple puts the SHA-256 of this value in the token's nonce claim; better-auth hashes the raw nonce and compares.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error("Apple returned no identity token.");
    const { givenName, familyName } = credential.fullName ?? {};
    let name: AppleName | null = givenName || familyName ? { firstName: givenName ?? undefined, lastName: familyName ?? undefined } : null;
    // Apple sends the name only the first time. Keep it until a sign-in succeeds, so a failed first exchange (an
    // invite-only server, no connection) does not lose it.
    if (name) await SecureStore.setItemAsync(PENDING_NAME_KEY, JSON.stringify({ user: credential.user, ...name })).catch(() => undefined);
    else name = await pendingAppleName(credential.user);
    return { provider: "apple", idToken: credential.identityToken, nonce: rawNonce, ...(name ? { name } : {}) };
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return null;
    throw e;
  }
}
