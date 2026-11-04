// The device side of native Google Sign-In (@react-native-google-signin/google-signin). The pure flow and error
// mapping are in google-native.ts. The library throws on import when its native module is missing (a build without
// it), so it is checked first and imported lazily.

import Constants from "expo-constants";
import { Platform, TurboModuleRegistry } from "react-native";

import { googleConfigFrom, googleConfigured } from "./google-config";
import { classifyNativeGoogleError, type NativeGoogleToken, type NativeStatusCodes } from "./google-native";

export function googleConfig() {
  return googleConfigFrom(Constants.expoConfig?.extra);
}

export function nativeGoogleAvailable(): boolean {
  return googleConfigured(googleConfig(), Platform.OS) && TurboModuleRegistry.get("RNGoogleSignin") != null;
}

/** Shows Google's account sheet and returns the ID token. Never throws. */
export async function requestGoogleIdToken(): Promise<NativeGoogleToken> {
  let codes: NativeStatusCodes | undefined;
  try {
    const { GoogleSignin, statusCodes } = await import("@react-native-google-signin/google-signin");
    codes = statusCodes;
    const { webClientId, iosClientId } = googleConfig();
    GoogleSignin.configure({ webClientId, ...(Platform.OS === "ios" ? { iosClientId } : {}) });
    if (Platform.OS === "android") await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the previously chosen account so the picker always opens (a household may share a phone).
    await GoogleSignin.signOut().catch(() => undefined);
    const result = await GoogleSignin.signIn();
    if (result.type === "cancelled") return { status: "cancelled" };
    const idToken = result.data.idToken;
    return idToken ? { status: "ok", idToken } : { status: "failed", reason: "Google returned no ID token" };
  } catch (e) {
    return classifyNativeGoogleError(e, codes);
  }
}

/** Forgets the Google account on the device at sign-out. Best effort. */
export async function signOutOfGoogle() {
  if (!nativeGoogleAvailable()) return;
  try {
    const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
    await GoogleSignin.signOut();
  } catch {
    // not signed in with Google
  }
}
