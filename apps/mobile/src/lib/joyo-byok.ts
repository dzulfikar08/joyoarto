// The member's own Joyo AI key on this phone: the secure store (Android Keystore / iOS Keychain), like the session
// token. Never in the query cache, a file or a log. Removed at sign-out, so the next account on the phone starts
// without it. The shape and its checks are pure in ./joyo.ts.

import * as SecureStore from "expo-secure-store";

import { onSessionChange } from "./auth";
import { parseByok, type ByokSettings } from "./joyo";
import { observable, useObservable } from "./observable";

const KEY = "joyoarto.joyo.byok";

const store = observable<ByokSettings | null | undefined>(undefined);
let loading: Promise<void> | null = null;

export function loadByok(): Promise<void> {
  loading ??= SecureStore.getItemAsync(KEY)
    .then((raw) => store.set(parseByok(raw)))
    .catch(() => store.set(null));
  return loading;
}

/** undefined while it is being read. */
export function useByok(): ByokSettings | null | undefined {
  return useObservable(store);
}

export async function saveByok(settings: ByokSettings | null): Promise<void> {
  if (settings) await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
  else await SecureStore.deleteItemAsync(KEY);
  store.set(settings);
}

onSessionChange({
  signOut: () => {
    void saveByok(null).catch(() => undefined);
  },
});
