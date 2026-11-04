// Small per-device preferences that are not settings (the last account used in the add sheet). Not secret.

import { jsonFile } from "./json-file";

type Prefs = { lastAccountId?: string };

const file = jsonFile<Prefs>("prefs.json");
let cache: Prefs | null = null;

export async function loadPrefs(): Promise<Prefs> {
  cache ??= (await file.read()) ?? {};
  return cache;
}

export function lastAccountId(): string {
  return cache?.lastAccountId ?? "";
}

export function rememberAccount(id: string) {
  cache = { ...cache, lastAccountId: id };
  file.write(cache);
}
