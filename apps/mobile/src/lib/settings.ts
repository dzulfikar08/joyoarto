import { ADB_TEST_PACKAGE, SOURCES, type SourceId } from "@/src/capture/parsers";
import { NotificationCapture } from "@/modules/notification-capture";

import { loadSession } from "./auth";
import { jsonFile } from "./json-file";
import { observable, useObservable } from "./observable";

export type Settings = {
  /** The capture switch. Off by default; the native listener reads nothing while it is off. */
  captureEnabled: boolean;
  /** Allow-listed packages (Android). */
  packages: string[];
  /** Account each source's captures go to; unset = the household's most used account. */
  accountBySource: Partial<Record<SourceId, string>>;
  /** Send low-confidence parses without asking first. */
  autoSendLowConfidence: boolean;
  /** Debug builds: also read notifications posted with `adb shell cmd notification post`. */
  acceptAdbTests: boolean;
  /** Dev only: answer statement uploads locally instead of calling the server. */
  mockStatementFile: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  captureEnabled: false,
  packages: SOURCES.flatMap((s) => s.packages),
  accountBySource: {},
  autoSendLowConfidence: false,
  acceptAdbTests: false,
  mockStatementFile: false,
};

const file = jsonFile<Settings>("settings.json");
const store = observable<Settings>(DEFAULT_SETTINGS);
let loaded: Promise<Settings> | null = null;

export function loadSettings(): Promise<Settings> {
  loaded ??= file.read().then((s) => {
    const value = { ...DEFAULT_SETTINGS, ...s };
    store.set(value);
    return value;
  });
  return loaded;
}

export function getSettings() {
  return store.get();
}

export async function updateSettings(patch: Partial<Settings>) {
  await loadSettings();
  const next = { ...store.get(), ...patch };
  store.set(next);
  file.write(next);
  await syncNativeConfig(next);
}

/** What belongs to the signed-in account: reset at sign-out so the next account starts clean. */
export const ACCOUNT_CAPTURE_SETTINGS = ["captureEnabled", "packages", "accountBySource", "autoSendLowConfidence"] as const;

export function resetAccountSettings() {
  const patch: Partial<Settings> = {};
  for (const k of ACCOUNT_CAPTURE_SETTINGS) Object.assign(patch, { [k]: DEFAULT_SETTINGS[k] });
  return updateSettings(patch);
}

/**
 * The native listener only knows the switch and the allow-list. It reads notifications only while capture is on
 * and someone is signed in: signed out, nothing is read (the switch comes back on at the next sign-in).
 */
export async function syncNativeConfig(s: Settings) {
  const packages = s.acceptAdbTests ? [...new Set([...s.packages, ADB_TEST_PACKAGE])] : s.packages;
  const signedIn = (await loadSession()) !== null;
  NotificationCapture.setConfig(s.captureEnabled && signedIn, packages);
}

export function useSettings() {
  return useObservable(store);
}
