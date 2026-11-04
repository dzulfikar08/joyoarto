// The app's oRPC client instance (see src/lib/rpc.ts) and its TanStack Query helpers. Screens use:
//   useQuery(orpc.reports.dashboard.queryOptions({ input: { month } }))
//   useMutation({ mutationFn: (v) => client.transactions.categorize(v) })
// and invalidate by procedure: queryClient.invalidateQueries({ queryKey: orpc.reports.key() }).

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { fetch as expoFetch } from "expo/fetch";

import type { FetchLike } from "./api";
import { currentCredentials } from "./auth";
import { createRpcClient } from "./rpc";

export const client = createRpcClient(currentCredentials, expoFetch as unknown as FetchLike);
export const orpc = createTanstackQueryUtils(client);
