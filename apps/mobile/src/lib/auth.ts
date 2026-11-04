import * as SecureStore from "expo-secure-store";

import { createApi, DEFAULT_SERVER, type ApiClient, type Credentials } from "./api";
import { observable, useObservable } from "./observable";
import type { Me } from "./types";

const TOKEN_KEY = "joyoarto.token";
const SERVER_KEY = "joyoarto.server";
const ME_KEY = "joyoarto.me";

export type Session = Credentials & { me: Me | null };

/** undefined = not loaded yet; null = signed out. */
const session = observable<Session | null | undefined>(undefined);

let loading: Promise<Session | null> | null = null;

/** Reads the stored token (Android Keystore / iOS Keychain through expo-secure-store). Safe to call from headless JS. */
export function loadSession(): Promise<Session | null> {
  const current = session.get();
  if (current !== undefined) return Promise.resolve(current);
  loading ??= (async () => {
    const [token, server, me] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(SERVER_KEY),
      SecureStore.getItemAsync(ME_KEY),
    ]);
    const value = token ? { token, server: server ?? DEFAULT_SERVER, me: me ? (JSON.parse(me) as Me) : null } : null;
    session.set(value);
    return value;
  })();
  return loading;
}

export async function signIn(creds: Credentials, me: Me) {
  await SecureStore.setItemAsync(TOKEN_KEY, creds.token.trim());
  await SecureStore.setItemAsync(SERVER_KEY, creds.server);
  await SecureStore.setItemAsync(ME_KEY, JSON.stringify(me));
  session.set({ ...creds, token: creds.token.trim(), me });
}

export async function updateMe(me: Me) {
  const s = session.get();
  if (!s) return;
  await SecureStore.setItemAsync(ME_KEY, JSON.stringify(me));
  session.set({ ...s, me });
}

export async function signOut() {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(ME_KEY)]);
  session.set(null);
}

export function useSession() {
  return useObservable(session);
}

/** The API client for the stored session, or null when signed out. */
export async function getApi(): Promise<ApiClient | null> {
  const s = await loadSession();
  return s ? createApi(s) : null;
}

export function useApi(): ApiClient {
  const s = useSession();
  if (!s) throw new Error("useApi needs a signed-in session");
  return createApi(s);
}
