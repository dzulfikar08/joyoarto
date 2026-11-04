// Sign in with Apple (iOS only), the way JoyoRogo does it: expo-apple-authentication's sheet with a hashed nonce,
// then the identity token goes to better-auth (`apple` provider, audience = the bundle id, APPLE_BUNDLE_IDS on the
// server). App Store guideline 4.8: an app that offers Google sign-in must offer Sign in with Apple too.

import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
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
    return {
      provider: "apple",
      idToken: credential.identityToken,
      nonce: rawNonce,
      ...(givenName || familyName ? { name: { firstName: givenName ?? undefined, lastName: familyName ?? undefined } } : {}),
    };
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return null;
    throw e;
  }
}
