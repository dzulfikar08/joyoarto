import { ADB_TEST_PACKAGE, SOURCES, type SourceId } from "@/src/capture/parsers";
import { NotificationCapture } from "@/modules/notification-capture";

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
  syncNativeConfig(next);
}

/** The native listener only knows the switch and the allow-list. */
export function syncNativeConfig(s: Settings) {
  const packages = s.acceptAdbTests ? [...new Set([...s.packages, ADB_TEST_PACKAGE])] : s.packages;
  NotificationCapture.setConfig(s.captureEnabled, packages);
}

export function useSettings() {
  return useObservable(store);
}
