// What a read-only connection (an OAuth consent or brk_ token without finance:write) or a Free household gets from the MCP server.

import { beforeEach, expect, test } from "bun:test";

import type { Principal, Scope } from "@baroka/api/context";
import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { testAccount, testDb, testPrincipal } from "../../../packages/api/src/test/d1";
import { createMcpServer } from "./mcp-server";

let db: Database;
let dewi: Principal;

beforeEach(async () => {
  ({ db } = await testDb());
  dewi = await testPrincipal(db, "Dewi");
  await testAccount(db, dewi, "GoPay");
});

async function connect(scopes: Scope[], connectorAllowed = true) {
  const pending: Promise<unknown>[] = [];
  const server = createMcpServer({
    db,
    principal: { ...dewi, scopes, via: "oauth", clientId: "claude" },
    clientId: "claude",
    waitUntil: (p) => void pending.push(p),
    connectorAllowed,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return { client, server, settle: () => Promise.all(pending) };
}

test("a read-only connection lists no write tools and is told it is read-only", async () => {
  const { client } = await connect(["finance:read"]);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain("list_accounts");
  expect(names).toContain("search_transactions");
  for (const write of ["quick_add", "import_transactions", "categorize", "create_account", "undo_import", "set_budget"]) expect(names).not.toContain(write);
  expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  expect(client.getInstructions()).toContain("This connection is read-only");
});

test("a read-only connection cannot call a write tool, and nothing is saved", async () => {
  const { client } = await connect(["finance:read"]);
  const result = await client.callTool({ name: "quick_add", arguments: { amountText: "25rb", description: "kopi" } });
  expect(result.isError).toBe(true);
  expect(await db.select().from(schema.transaction)).toHaveLength(0);
});

test("read and write lists the write tools, and they run", async () => {
  const { client, settle } = await connect(["finance:read", "finance:write"]);
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toContain("quick_add");
  expect(names).toContain("import_transactions");
  expect(client.getInstructions()).not.toContain("This connection is read-only");
  const result = await client.callTool({ name: "quick_add", arguments: { amountText: "25rb", description: "kopi" } });
  expect(result.isError).toBeFalsy();
  expect(await db.select().from(schema.transaction)).toHaveLength(1);
  await settle();
});

test("a Free household gets the read tools, and they succeed; writes are not listed", async () => {
  const { client, settle } = await connect(["finance:read", "finance:write"], false);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain("list_accounts");
  expect(names).not.toContain("quick_add");
  expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  expect(client.getInstructions()).toContain("Free plan");
  const read = await client.callTool({ name: "list_accounts", arguments: {} });
  expect(read.isError).toBeFalsy();
  const write = await client.callTool({ name: "quick_add", arguments: { amountText: "25rb", description: "kopi" } });
  expect(write.isError).toBe(true);
  expect(await db.select().from(schema.transaction)).toHaveLength(0);
  await settle();
});
