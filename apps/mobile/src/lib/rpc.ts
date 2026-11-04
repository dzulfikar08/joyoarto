// The typed API client: oRPC against the server's own router types (packages/api/src/routers/index.ts), like the web
// app (apps/web/src/lib/orpc.ts) and JoyoRogo's phone app. Every procedure the web uses is here, typed end to end:
// `client.transactions.search({ ... })`, and TanStack Query helpers as `orpc.reports.dashboard.queryOptions(...)`.
//
// Only types come from @baroka/api (`import type`), so no server code is bundled. Requests go to `<server>/rpc` with
// `Authorization: Bearer <token>` (a session token or a brk_ token, src/lib/session-store.ts). The REST client
// (src/lib/api.ts) stays for multipart uploads (statement PDFs) and the headless capture task.

import type { AppRouterClient } from "@baroka/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { FetchLike } from "./api";

export type RpcCredentials = { server: string; token: string };

export type { AppRouterClient };

/** Output of a procedure: `Out<AppRouterClient["reports"]["dashboard"]>`. */
export type Out<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
/** Input of a procedure. */
export type In<F> = F extends (input: infer I, ...rest: never[]) => unknown ? I : never;

const TIMEOUT_MS = 30_000;

/**
 * `getCredentials` is read on every call, so one client follows sign-in and sign-out. Signed out, calls fail with an
 * UNAUTHORIZED-shaped error before anything is sent.
 */
export function createRpcClient(getCredentials: () => RpcCredentials | null, fetchImpl: FetchLike): AppRouterClient {
  const link = new RPCLink({
    url: () => {
      const c = getCredentials();
      if (!c) throw Object.assign(new Error("Not signed in."), { code: "UNAUTHORIZED", status: 401 });
      return `${c.server.replace(/\/+$/, "")}/rpc`;
    },
    headers: () => {
      const c = getCredentials();
      return c ? { authorization: `Bearer ${c.token}` } : {};
    },
    async fetch(request, init) {
      // A plain (url, init) call: React Native's and Expo's fetch take that most reliably, and tests can fake it.
      const method = request.method.toUpperCase();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const abort = () => controller.abort();
      request.signal?.addEventListener?.("abort", abort);
      try {
        return await fetchImpl(request.url, {
          ...init,
          method,
          headers: request.headers,
          body: method === "GET" || method === "HEAD" ? undefined : await request.blob(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener?.("abort", abort);
      }
    },
  });
  return createORPCClient(link);
}
