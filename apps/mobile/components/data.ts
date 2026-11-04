// Shared reads every screen uses (one cache entry each, persisted for offline starts) and the cache refresh after a
// ledger write. New screens: read with `useQuery(orpc.<procedure>.queryOptions(...))`, write with
// `client.<procedure>(...)` in a useMutation, then `invalidateLedger()`.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { updateMe, useSession } from "@/src/lib/auth";
import { accountOptions, categoryOptions, type PickerOption } from "@/src/lib/options";
import { orpc } from "@/src/lib/orpc";
import { queryClient } from "@/src/lib/query";

export function useAccounts() {
  return useQuery(orpc.accounts.list.queryOptions({ input: {} }));
}

export function useCategories() {
  return useQuery({ ...orpc.categories.list.queryOptions(), staleTime: 5 * 60_000 });
}

/** Grouped picker items (components/ui Picker). */
export function useAccountGroups() {
  const { data } = useAccounts();
  return useMemo(() => accountOptions(data?.accounts ?? []), [data]);
}

export function useCategoryGroups(kind?: "expense" | "income" | "transfer") {
  const { data } = useCategories();
  return useMemo(() => categoryOptions((data?.categories ?? []).filter((c) => !kind || c.kind === kind)), [data, kind]);
}

/** Flat items for the older Select (capture screens). */
export function useAccountOptions(): PickerOption[] {
  const groups = useAccountGroups();
  return useMemo(() => groups.flatMap((g) => g.options), [groups]);
}

export function useCategoryOptions(): PickerOption[] {
  const groups = useCategoryGroups();
  return useMemo(() => groups.flatMap((g) => g.options.map((o) => ({ ...o, hint: g.label ?? undefined }))), [groups]);
}

/** After any write to transactions: lists, the dashboard, balances and budgets refetch. */
export function invalidateLedger() {
  for (const key of [orpc.transactions.key(), orpc.reports.key(), orpc.accounts.key(), orpc.budgets.key()]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Who is signed in, fresh from the server (household names change, the active household can switch, the Google
 * avatar updates), falling back to what was stored at sign-in.
 */
export function useMe() {
  const session = useSession();
  const q = useQuery({ ...orpc.me.queryOptions(), enabled: !!session });
  useEffect(() => {
    if (q.data) void updateMe(q.data);
  }, [q.data]);
  return q.data ?? session?.me ?? null;
}
