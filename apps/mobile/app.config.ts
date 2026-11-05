import type { ConfigContext, ExpoConfig } from "expo/config";

/** Same as src/lib/google-config.ts reversedClientId (kept inline: the config loader runs this file alone). */
const reversedClientId = (id: string) => id.trim().split(".").reverse().join(".");

const UPDATE_CHANNELS = ["production", "preview"] as const;

/**
 * app.json stays the source of truth; this adds what depends on the build environment (docs/mobile-auth.md):
 *
 * - JOYOARTO_GOOGLE_IOS_CLIENT_ID (or app.json extra.googleIosClientId): the iOS OAuth client of the Google Cloud project
 *   `joyorogo`. When set, native Google Sign-In is on for iOS: the google-signin config plugin adds the reversed client
 *   id as a URL scheme. Unset, iOS hides the Google button (Sign in with Apple, tokens and the demo still work).
 * - JOYOARTO_GOOGLE_WEB_CLIENT_ID overrides extra.googleWebClientId (the server's GOOGLE_CLIENT_ID; Android's ID tokens
 *   are issued for it). Client ids are public, not secrets.
 * - JOYOARTO_UPDATE_CHANNEL (docs/ota.md): the EAS Update channel the binary listens to, sent as the expo-channel-name
 *   request header. "production" (default: Play and TestFlight builds) or "preview" (the sideload APK of android.yml),
 *   so a test update never reaches store users. Everything here is part of the fingerprint runtimeVersion, so
 *   scripts/ota.sh publishes with the same variables the binary was built with.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const extra = (config.extra ?? {}) as Record<string, unknown>;
  const pick = (env: string | undefined, fallback: unknown) => env?.trim() || (typeof fallback === "string" ? fallback.trim() : "");
  const googleWebClientId = pick(process.env.JOYOARTO_GOOGLE_WEB_CLIENT_ID, extra.googleWebClientId);
  const googleIosClientId = pick(process.env.JOYOARTO_GOOGLE_IOS_CLIENT_ID, extra.googleIosClientId);
  const channel = process.env.JOYOARTO_UPDATE_CHANNEL?.trim() || "production";
  if (!(UPDATE_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`JOYOARTO_UPDATE_CHANNEL must be one of ${UPDATE_CHANNELS.join(", ")} (got "${channel}")`);
  }
  const plugins = [...(config.plugins ?? [])];
  if (googleIosClientId) plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: reversedClientId(googleIosClientId) }]);
  return {
    ...config,
    name: config.name ?? "JoyoArto",
    slug: config.slug ?? "joyoarto",
    plugins,
    updates: { ...config.updates, requestHeaders: { "expo-channel-name": channel } },
    extra: { ...extra, googleWebClientId, googleIosClientId },
  };
};
