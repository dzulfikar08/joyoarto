// Where the sign-in lives on the phone: one bearer credential, the server it belongs to, and who it is. Pure over a
// small key-value interface so it is unit-tested; src/lib/auth.ts binds it to expo-secure-store (Android Keystore,
// iOS Keychain).
//
// Two kinds of credential, both sent as `Authorization: Bearer` to REST (/api) and oRPC (/rpc):
// - "session": a better-auth session token from Google / Apple sign-in (the server's bearer plugin). Sign-out
//   revokes it on the server.
// - "token": a `brk_` personal access token pasted from the web, or the demo code's 7-day token.

import { observable } from "./observable";

export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

export type CredentialKind = "session" | "token";

/** Who the credential speaks for (GET /api/me). Only what the app reads; extra fields are kept as they come. */
export type Me = {
  user: { id: string; name: string | null; email: string | null; image?: string | null };
  household: { id: string; name: string | null; baseCurrency: string };
  scopes: string[];
  via: string;
  /** The store reviewers' demo account (made-up data, reset daily). Older servers leave it out. */
  demo?: boolean;
};

export type Session = { server: string; token: string; kind: CredentialKind; me: Me | null };

export const KEYS = {
  token: "joyoarto.token",
  server: "joyoarto.server",
  me: "joyoarto.me",
  kind: "joyoarto.kind",
} as const;

/** A `brk_` token is a personal access token; anything else is a session token. */
export function kindOf(token: string): CredentialKind {
  return token.trim().startsWith("brk_") ? "token" : "session";
}

export function createSessionStore(storage: Storage, defaultServer: string) {
  /** undefined = not loaded yet; null = signed out. */
  const state = observable<Session | null | undefined>(undefined);
  let loading: Promise<Session | null> | null = null;

  async function load(): Promise<Session | null> {
    const current = state.get();
    if (current !== undefined) return current;
    loading ??= (async () => {
      const [token, server, me, kind] = await Promise.all([
        storage.getItem(KEYS.token),
        storage.getItem(KEYS.server),
        storage.getItem(KEYS.me),
        storage.getItem(KEYS.kind),
      ]);
      let parsed: Me | null = null;
      try {
        parsed = me ? (JSON.parse(me) as Me) : null;
      } catch {
        parsed = null;
      }
      const value: Session | null = token
        ? { token, server: server ?? defaultServer, kind: kind === "session" || kind === "token" ? kind : kindOf(token), me: parsed }
        : null;
      // A sign-in that finished while reading wins.
      if (state.get() === undefined) state.set(value);
      return state.get() ?? null;
    })();
    return loading;
  }

  async function save(session: Session) {
    const token = session.token.trim();
    await storage.setItem(KEYS.token, token);
    await storage.setItem(KEYS.server, session.server);
    await storage.setItem(KEYS.kind, session.kind);
    if (session.me) await storage.setItem(KEYS.me, JSON.stringify(session.me));
    else await storage.deleteItem(KEYS.me);
    state.set({ ...session, token });
  }

  async function updateMe(me: Me) {
    const s = state.get();
    if (!s) return;
    await storage.setItem(KEYS.me, JSON.stringify(me));
    state.set({ ...s, me });
  }

  /** Forgets the credential (the server keeps the last-used server address for the next sign-in). */
  async function clear() {
    await Promise.all([storage.deleteItem(KEYS.token), storage.deleteItem(KEYS.me), storage.deleteItem(KEYS.kind)]);
    state.set(null);
  }

  return { state, load, save, updateMe, clear, get: () => state.get() };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

/** An in-memory Storage for tests and previews. */
export function memoryStorage(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
    deleteItem: async (k) => {
      delete data[k];
    },
  };
}
