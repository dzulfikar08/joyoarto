// TanStack Query policy for the app, pure so it is unit-tested; src/lib/query.ts wires it up.

import { isRetryable, isUnauthorized } from "./errors";

/** Fresh for a minute: switching tabs does not refetch, pull-to-refresh and app focus do. */
export const STALE_MS = 60_000;
/** Kept in memory (and on disk, for the persisted ones) for a day after the last screen using it closed. */
export const GC_MS = 24 * 3_600_000;
/** Persisted reads are shown offline for up to a week. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 3_600_000;
/** Bump when a persisted response shape changes; older caches are dropped on start. */
export const CACHE_BUSTER = "v1";

/**
 * oRPC procedures whose last answer is kept on the device, so the app opens with numbers while offline. Cheap ones
 * only: the dashboard of each month visited, accounts, categories and who is signed in. Transaction pages are not
 * persisted (large, and stale rows are confusing).
 */
export const PERSISTED_PROCEDURES = new Set(["me", "accounts.list", "categories.list", "reports.dashboard", "joyo.status"]);

/** oRPC query keys look like `[["reports", "dashboard"], { input, type: "query" }]`. */
export function procedureOfKey(key: readonly unknown[]): string | null {
  const path = key[0];
  if (!Array.isArray(path) || !path.every((p) => typeof p === "string")) return null;
  return path.join(".");
}

export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string } }): boolean {
  if (query.state.status !== "success") return false;
  const procedure = procedureOfKey(query.queryKey);
  return procedure !== null && PERSISTED_PROCEDURES.has(procedure);
}

/** Two retries for what may pass next time (offline, 5xx, 429); never for a 4xx answer or a sign-out. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isUnauthorized(error)) return false;
  return failureCount < 2 && isRetryable(error);
}
