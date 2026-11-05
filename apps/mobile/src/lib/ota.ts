/**
 * Which JS bundle a release build runs (docs/ota.md), for the More page's footer. Pure: the caller passes
 * expo-updates' `Updates.isEnabled` and `Updates.currentlyRunning`-style fields.
 *
 * "built-in" is the bundle inside the binary (also after a rollback or an emergency launch, when expo-updates fell back
 * to it); "update 1a2b3c4d" is a downloaded EAS Update. The runtime prefix is what `scripts/ota.sh --runtime` prints:
 * an update only reaches a phone whose runtime matches.
 */
export type OtaRunning = {
  enabled: boolean;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch?: boolean;
  updateId?: string | null;
  runtimeVersion?: string | null;
  channel?: string | null;
};

export function otaLabel(r: OtaRunning): string | null {
  if (!r.enabled) return null;
  const embedded = r.isEmbeddedLaunch || r.isEmergencyLaunch || !r.updateId;
  const parts = [embedded ? "built-in" : `update ${r.updateId!.slice(0, 8)}`];
  if (r.channel) parts.push(r.channel);
  if (r.runtimeVersion) parts.push(`runtime ${r.runtimeVersion.slice(0, 8)}`);
  return parts.join(" · ");
}
