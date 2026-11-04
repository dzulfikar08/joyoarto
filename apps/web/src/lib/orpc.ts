import type { AppRouterClient } from "@baroka/api/routers/index";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";

/** Production serves the API from the same origin as the app; dev points at wrangler dev (.env.development). */
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ORPCError && error.code === "UNAUTHORIZED" && !location.pathname.startsWith("/login")) {
        location.assign(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
      }
    },
  }),
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false } },
});

const link = new RPCLink({
  url: `${SERVER_URL}/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
