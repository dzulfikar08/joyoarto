// Google client ids from the app config (app.json `extra`, app.config.ts). Public values, not secrets. Pure.

export type GoogleConfig = { webClientId: string; iosClientId: string };

export function googleConfigFrom(extra: Record<string, unknown> | undefined | null): GoogleConfig {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { webClientId: str(extra?.googleWebClientId), iosClientId: str(extra?.googleIosClientId) };
}

/** Whether this platform has the client ids native Google Sign-In needs. */
export function googleConfigured(config: GoogleConfig, os: string): boolean {
  if (!config.webClientId) return false;
  if (os === "ios") return !!config.iosClientId;
  return os === "android";
}

/** "123-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.123-abc" (the iOS URL scheme). */
export function reversedClientId(clientId: string): string {
  return clientId.trim().split(".").reverse().join(".");
}
