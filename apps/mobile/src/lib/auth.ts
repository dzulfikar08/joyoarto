// The signed-in credential, bound to expo-secure-store (Android Keystore, iOS Keychain). The store itself is pure
// (src/lib/session-store.ts); this file adds the sign-in flows and sign-out side effects. Safe to import from the
// headless capture task (no React Native UI imports).

import * as SecureStore from "expo-secure-store";

import { createApi, DEFAULT_SERVER, type ApiClient, type Credentials } from "./api";
import { useObservable } from "./observable";
import { storeSafe } from "./platform";
import type { RpcCredentials } from "./rpc";
import { createSessionStore, kindOf, type CredentialKind, type Me, type Session, type Storage } from "./session-store";
import { exchangeIdToken, revokeSession, type IdTokenSignIn } from "./social-auth";

export type { Me, Session };

const secureStorage: Storage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

export const sessions = createSessionStore(secureStorage, DEFAULT_SERVER);

/** Reads the stored credential once. Safe to call from headless JS. */
export const loadSession = () => sessions.load();

export function useSession() {
  return useObservable(sessions.state);
}

/** The bearer the REST and oRPC clients send, or null when signed out. */
export function currentCredentials(): RpcCredentials | null {
  const s = sessions.get();
  return s ? { server: s.server, token: s.token } : null;
}

type Listener = () => void;
const signInListeners = new Set<Listener>();
const signOutListeners = new Set<Listener>();

/** Runs after every sign-in and sign-out (src/lib/query.ts drops the previous account's cached data). */
export function onSessionChange(on: { signIn?: Listener; signOut?: Listener }) {
  if (on.signIn) signInListeners.add(on.signIn);
  if (on.signOut) signOutListeners.add(on.signOut);
  return () => {
    if (on.signIn) signInListeners.delete(on.signIn);
    if (on.signOut) signOutListeners.delete(on.signOut);
  };
}

/** Stores a checked credential (`me` came from GET /api/me with it). */
export async function signIn(creds: Credentials, me: Me, kind: CredentialKind = kindOf(creds.token)) {
  await sessions.save({ server: creds.server.replace(/\/+$/, ""), token: creds.token, kind, me });
  for (const l of signInListeners) l();
}

/** Google / Apple: the platform's ID token becomes a JoyoArto session. Throws with a message to show. */
export async function signInWithIdToken(input: IdTokenSignIn) {
  const server = input.server.replace(/\/+$/, "");
  const { token } = await exchangeIdToken({ ...input, server });
  const me = await createApi({ server, token }, fetch, { storeSafe }).me();
  await signIn({ server, token }, me, "session");
}

export const updateMe = (me: Me) => sessions.updateMe(me);

/** Forgets the credential on the phone at once; a session token is also revoked on the server (best effort). */
export async function signOut() {
  const s = sessions.get();
  await sessions.clear();
  for (const l of signOutListeners) l();
  if (s?.kind === "session") void revokeSession(s.server, s.token);
}

/** The REST client for the stored credential, or null when signed out. */
export async function getApi(): Promise<ApiClient | null> {
  const s = await loadSession();
  return s ? createApi(s, fetch, { storeSafe }) : null;
}

export function useApi(): ApiClient {
  const s = useSession();
  if (!s) throw new Error("useApi needs a signed-in session");
  return createApi(s, fetch, { storeSafe });
}
