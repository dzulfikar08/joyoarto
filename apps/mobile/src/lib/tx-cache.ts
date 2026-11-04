// The transaction detail screen opens from a list row; there is no get-by-id procedure, so the row is handed over
// here, and refreshed from any loaded transactions.search page (src/lib/query.ts's cache) when the list refetches.

import type { QueryClient } from "@tanstack/react-query";

import type { AppRouterClient, Out } from "./rpc";

export type Tx = Out<AppRouterClient["transactions"]["search"]>["transactions"][number];

const handed = new Map<string, Tx>();

export function rememberTransaction(t: Tx) {
  handed.set(t.id, t);
  // Only the last few are needed.
  if (handed.size > 50) handed.delete(handed.keys().next().value!);
}

/** The freshest copy: a loaded search page first, else what the list handed over. */
export function findTransaction(qc: Pick<QueryClient, "getQueriesData">, key: readonly unknown[], id: string): Tx | null {
  for (const [, data] of qc.getQueriesData<{ pages?: { transactions: Tx[] }[]; transactions?: Tx[] }>({ queryKey: key })) {
    const pages = data?.pages ?? (data?.transactions ? [{ transactions: data.transactions }] : []);
    for (const p of pages) {
      const hit = p.transactions.find((t) => t.id === id);
      if (hit) return hit;
    }
  }
  return handed.get(id) ?? null;
}
