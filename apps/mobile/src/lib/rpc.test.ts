// The typed client against a fake server: the URL, the bearer header, and oRPC's wire format both ways.

import { expect, test } from "bun:test";

import { createRpcClient, type RpcCredentials } from "./rpc";

type Seen = { url: string; method: string; auth: string | null; body: string };

function server(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof Blob ? await init.body.text() : String(init?.body ?? "");
    const s = { url, method: init?.method ?? "GET", auth: headers.get("authorization"), body };
    seen.push(s);
    return answer(s);
  };
  return { seen, fetchImpl };
}

test("calls <server>/rpc/<path> with the bearer and decodes the answer", async () => {
  let creds: RpcCredentials | null = { server: "https://s/", token: "tok.sig" };
  const { seen, fetchImpl } = server(() => Response.json({ json: { categories: [{ slug: "food" }] } }));
  const client = createRpcClient(() => creds, fetchImpl);
  const res = await client.categories.list();
  expect(res).toEqual({ categories: [{ slug: "food" }] } as never);
  expect(seen[0]!.url).toBe("https://s/rpc/categories/list");
  expect(seen[0]!.auth).toBe("Bearer tok.sig");

  await client.transactions.search({ q: "kopi", limit: 20 });
  expect(seen[1]!.url).toBe("https://s/rpc/transactions/search");
  expect(JSON.parse(seen[1]!.body).json).toEqual({ q: "kopi", limit: 20 });

  // The credential is read per call.
  creds = { server: "https://other", token: "brk_x" };
  await client.categories.list();
  expect(seen[2]!.url).toBe("https://other/rpc/categories/list");
  expect(seen[2]!.auth).toBe("Bearer brk_x");
});

test("server errors arrive as ORPCError-shaped errors", async () => {
  const { fetchImpl } = server(() => Response.json({ json: { defined: false, code: "UNAUTHORIZED", status: 401, message: "Sign in", data: {} } }, { status: 401 }));
  const client = createRpcClient(() => ({ server: "https://s", token: "t" }), fetchImpl);
  await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Sign in" });
});

test("signed out: nothing is sent", async () => {
  const { seen, fetchImpl } = server(() => Response.json({ json: null }));
  const client = createRpcClient(() => null, fetchImpl);
  await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(seen).toHaveLength(0);
});
