// The app's QueryClient: retry and freshness policy (src/lib/query-policy.ts), refetch on app focus and reconnect,
// a small on-device cache of cheap reads for offline starts, and a sign-out on any UNAUTHORIZED answer.

import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { focusManager, MutationCache, onlineManager, QueryCache, QueryClient } from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";

import { onSessionChange, sessions, signOut } from "./auth";
import { isUnauthorized } from "./errors";
import { jsonFile } from "./json-file";
import { CACHE_BUSTER, GC_MS, PERSIST_MAX_AGE_MS, shouldPersistQuery, shouldRetry, STALE_MS } from "./query-policy";
import { toast } from "./toast";

/** A credential that stopped working (revoked token, expired session) signs out once, with a note. */
function onUnauthorized(error: unknown) {
  if (!isUnauthorized(error) || !sessions.get()) return;
  void signOut();
  toast.error("Signed out", "Your sign-in expired or was revoked. Sign in again.");
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: { staleTime: STALE_MS, gcTime: GC_MS, retry: shouldRetry, refetchOnWindowFocus: true, networkMode: "offlineFirst" },
    mutations: { retry: false, networkMode: "always" },
  },
});

const cacheFile = jsonFile<PersistedClient>("query-cache.json");

/** The persisted cache lives in the app's private documents directory and is deleted at sign-out. */
export const persister: Persister = {
  persistClient: async (client) => cacheFile.write(client),
  restoreClient: async () => (await cacheFile.read()) ?? undefined,
  removeClient: async () => cacheFile.remove(),
};

export const persistOptions = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: CACHE_BUSTER,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};

let bound = false;

/** App focus refetches stale queries; the network state pauses and resumes them. Call once at start. */
export function bindQueryLifecycle() {
  if (bound) return;
  bound = true;
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (s) => setFocused(s === "active"));
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    void getNetworkStateAsync()
      .then((s) => setOnline(s.isConnected !== false))
      .catch(() => undefined);
    const sub = addNetworkStateListener((s) => setOnline(s.isConnected !== false));
    return () => sub.remove();
  });
  // Another account's numbers must never show: drop everything cached at every sign-in and sign-out.
  const reset = () => {
    queryClient.clear();
    void persister.removeClient();
  };
  onSessionChange({ signIn: reset, signOut: reset });
}
