import type { ConfigContext, ExpoConfig } from "expo/config";

/** Same as src/lib/google-config.ts reversedClientId (kept inline: the config loader runs this file alone). */
const reversedClientId = (id: string) => id.trim().split(".").reverse().join(".");

/**
 * app.json stays the source of truth; this adds what depends on the build environment (docs/mobile-auth.md):
 *
 * - JOYOARTO_GOOGLE_IOS_CLIENT_ID (or app.json extra.googleIosClientId): the iOS OAuth client of the Google Cloud project
 *   `joyorogo`. When set, native Google Sign-In is on for iOS: the google-signin config plugin adds the reversed client
 *   id as a URL scheme. Unset, iOS hides the Google button (Sign in with Apple, tokens and the demo still work).
 * - JOYOARTO_GOOGLE_WEB_CLIENT_ID overrides extra.googleWebClientId (the server's GOOGLE_CLIENT_ID; Android's ID tokens
 *   are issued for it). Client ids are public, not secrets.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const extra = (config.extra ?? {}) as Record<string, unknown>;
  const pick = (env: string | undefined, fallback: unknown) => env?.trim() || (typeof fallback === "string" ? fallback.trim() : "");
  const googleWebClientId = pick(process.env.JOYOARTO_GOOGLE_WEB_CLIENT_ID, extra.googleWebClientId);
  const googleIosClientId = pick(process.env.JOYOARTO_GOOGLE_IOS_CLIENT_ID, extra.googleIosClientId);
  const plugins = [...(config.plugins ?? [])];
  if (googleIosClientId) plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: reversedClientId(googleIosClientId) }]);
  return {
    ...config,
    name: config.name ?? "JoyoArto",
    slug: config.slug ?? "joyoarto",
    plugins,
    extra: { ...extra, googleWebClientId, googleIosClientId },
  };
};
