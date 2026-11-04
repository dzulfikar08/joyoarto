import { beforeEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { count, eq, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import type { Context, Principal } from "../context";
import { chunk, rowsPerInsert } from "../lib/d1";
import { appRouter } from "../routers/index";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import {
  CSV_COLUMNS,
  EXPORT_COVERAGE,
  EXPORT_PAGE,
  accountDeletionPlan,
  decimalAmount,
  deleteAccount,
  deleteHousehold,
  disconnectApp,
  exportCsvChunks,
  exportJsonChunks,
  listConnections,
  pruneMcpAudit,
} from "./account";

let db: Database;
let sqlite: Awaited<ReturnType<typeof testDb>>["sqlite"];

beforeEach(async () => {
  ({ db, sqlite } = await testDb());
});

/** Rows of a table where a column equals a value, straight from SQLite. */
const rowsWhere = (table: string, column: string, value: string) =>
  (sqlite.query(`select count(*) as n from "${table}" where "${column}" = ?`).get(value) as { n: number }).n;

const TX_COUNT = EXPORT_PAGE * 2 + 345;

async function addTransactions(p: Principal, accountId: string, n: number, batchId: string | null = null) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: crypto.randomUUID(),
    householdId: p.householdId,
    accountId,
    date: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    amount: -(i + 1) * 100,
    currency: "IDR",
    description: i === 0 ? '=HYPERLINK("x"), "quoted"' : `Row ${i}`,
    dedupeKey: `k${i}`,
    importBatchId: batchId,
    createdBy: p.userId,
  }));
  for (const part of chunk(rows, rowsPerInsert(12))) await db.insert(schema.transaction).values(part);
  return rows.map((r) => r.id);
}

async function oauthConnection(userId: string, clientId = `client-${crypto.randomUUID()}`, name = "Claude") {
  await db.insert(schema.oauthClient).values({ id: crypto.randomUUID(), clientId, name, redirectUris: "[]" }).onConflictDoNothing();
  const refreshId = crypto.randomUUID();
  await db.insert(schema.oauthConsent).values({ id: crypto.randomUUID(), clientId, userId, scopes: "finance:read finance:write offline_access" });
  await db.insert(schema.oauthRefreshToken).values({
    id: refreshId,
    token: crypto.randomUUID(),
    clientId,
    userId,
    scopes: "finance:read offline_access",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(schema.oauthAccessToken).values({
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    clientId,
    userId,
    refreshId,
    scopes: "finance:read",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return clientId;
}

/** A household with a row in every finance table. */
async function seedEverything(p: Principal) {
  const accountId = await testAccount(db, p);
  const [cat] = await db.select().from(schema.category).where(eq(schema.category.householdId, p.householdId)).limit(1);
  const batchId = crypto.randomUUID();
  await db.insert(schema.importBatch).values({ id: batchId, householdId: p.householdId, accountId, source: "csv", createdBy: p.userId });
  const ids = await addTransactions(p, accountId, TX_COUNT, batchId);
  const tagId = crypto.randomUUID();
  await db.insert(schema.tag).values({ id: tagId, householdId: p.householdId, name: "mudik" });
  await db.insert(schema.transactionTag).values({ transactionId: ids[0]!, tagId });
  await db.insert(schema.budget).values({ id: crypto.randomUUID(), householdId: p.householdId, categoryId: cat!.id, amount: 100_000_00 });
  await db.insert(schema.importMapping).values({ id: crypto.randomUUID(), householdId: p.householdId, name: "BCA", config: '{"date":0}' });
  await db.insert(schema.planScenario).values({ id: crypto.randomUUID(), householdId: p.householdId, name: "Car", plan: { items: [] }, createdBy: p.userId, updatedBy: p.userId });
  await db.insert(schema.paymentHint).values({ householdId: p.householdId, source: "gopay", ref: "G1", date: "2026-01-01", amount: -100, merchant: "Kopi" });
  await db.insert(schema.householdInvite).values({
    id: crypto.randomUUID(),
    householdId: p.householdId,
    email: "family@example.com",
    role: "member",
    tokenHash: "secret-invite-hash",
    invitedBy: p.userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(schema.apiToken).values({ id: crypto.randomUUID(), userId: p.userId, name: "laptop", prefix: "brk_abc", tokenHash: "secret-token-hash", scopes: "finance:read" });
  await db.insert(schema.mcpAudit).values({ id: crypto.randomUUID(), userId: p.userId, clientId: "api-token", tool: "list_accounts", args: "{}", outcome: "ok", createdAt: Date.now() });
  const conversationId = crypto.randomUUID();
  await db.insert(schema.joyoConversation).values({ id: conversationId, householdId: p.householdId, userId: p.userId, title: "Makan bulan ini" });
  await db.insert(schema.joyoMessage).values({ id: crypto.randomUUID(), conversationId, role: "user", content: "Berapa pengeluaran makan bulan ini?" });
  await db.insert(schema.aiUsage).values({ id: crypto.randomUUID(), userId: p.userId, householdId: p.householdId, kind: "chat", engine: "hosted", model: "claude-opus-5-5", outcome: "ok", createdAt: new Date() });
  await db.insert(schema.session).values({ id: crypto.randomUUID(), token: "secret-session-token", userId: p.userId, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: new Date(), ipAddress: "10.0.0.1" });
  await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: "google-1", providerId: "google", userId: p.userId, accessToken: "secret-google-token", updatedAt: new Date() });
  await db.insert(schema.emailImportAddress).values({ householdId: p.householdId, token: "secretimportaddresstokenxx", createdBy: p.userId });
  await db.insert(schema.inboundEmail).values({ id: crypto.randomUUID(), householdId: p.householdId, fromAddress: "a@b.com", userId: p.userId, subject: "Statement", status: "no_pdf", detail: {} });
  await db.insert(schema.joyoProStatus).values({ userId: p.userId, pro: true, until: new Date(Date.now() + 86_400_000), plan: "monthly", source: "doku", checkedAt: new Date(), expiresAt: new Date(), lastProUntil: new Date(Date.now() + 86_400_000) });
  await db.insert(schema.usageCounter).values({ userId: p.userId, metric: "statement_import", period: "2026-11", count: 1 });
  await oauthConnection(p.userId);
  return { accountId, ids };
}

async function exportOf(p: Principal) {
  let text = "";
  for await (const piece of exportJsonChunks(db, p)) text += piece;
  return { text, data: JSON.parse(text) as Record<string, unknown> };
}

/** Follows "a.b" and "list[].field" (the first non-empty field among the list's items). */
function resolve(data: unknown, path: string): unknown {
  const [head, ...rest] = path.split(".");
  const tail = rest.join(".");
  if (head!.endsWith("[]")) {
    const items = ((data as Record<string, unknown[]>)[head!.slice(0, -2)] ?? []).map((item) => resolve(item, tail));
    return items.find((v) => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0));
  }
  const value = (data as Record<string, unknown> | null)?.[head!];
  return tail ? resolve(value, tail) : value;
}

test("export covers every table of the schema, with data, and no secrets", async () => {
  const p = await testPrincipal(db);
  await seedEverything(p);
  const { text, data } = await exportOf(p);

  const tables = Object.values(schema)
    .filter((v) => is(v, SQLiteTable))
    .map((v) => getTableName(v as SQLiteTable));
  expect(tables.length).toBeGreaterThan(20);
  const missing = tables.filter((name) => !(name in EXPORT_COVERAGE));
  expect(missing).toEqual([]);

  for (const [table, where] of Object.entries(EXPORT_COVERAGE)) {
    if (where.startsWith("not exported")) continue;
    const path = where.split(/[ ,(]/)[0]!;
    const value = resolve(data, path);
    expect({ table, path, present: value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0) }).toEqual({ table, path, present: true });
  }
  expect((data.transactions as unknown[]).length).toBe(TX_COUNT);
  expect((data.transactions as { tags: string[] }[]).some((t) => t.tags.includes("mudik"))).toBe(true);
  expect((data.connectedApps as { name: string }[])[0]?.name).toBe("Claude");
  expect((data.importMappings as { config: unknown }[])[0]?.config).toEqual({ date: 0 });

  for (const secret of ["secret-invite-hash", "secret-token-hash", "secret-session-token", "secret-google-token", "secretimportaddresstokenxx"]) expect(text).not.toContain(secret);
});

test("export holds only the active household's finance data", async () => {
  const a = await testPrincipal(db, "A");
  const b = await testPrincipal(db, "B");
  await addTransactions(a, await testAccount(db, a), 3);
  await addTransactions(b, await testAccount(db, b), 5);
  const { data } = await exportOf(a);
  expect((data.transactions as unknown[]).length).toBe(3);
  expect((data.accounts as { householdId: string }[]).every((x) => x.householdId === a.householdId)).toBe(true);
});

test("CSV export: one line per transaction, quoted and formula-safe, decimal amounts", async () => {
  const p = await testPrincipal(db);
  await addTransactions(p, await testAccount(db, p), 1205);
  let csv = "";
  for await (const piece of exportCsvChunks(db, p)) csv += piece;
  const lines = csv.split("\r\n").filter(Boolean);
  expect(lines[0]).toBe(`﻿${CSV_COLUMNS.join(",")}`);
  expect(lines).toHaveLength(1206);
  expect(csv).toContain(`"'=HYPERLINK(""x""), ""quoted"""`);
  expect(decimalAmount(-2_500_000, "IDR")).toBe("-25000.00");
  expect(decimalAmount(5, "IDR")).toBe("0.05");
  expect(decimalAmount(-7, "JPY")).toBe("-7");
});

test("export, connections and deletion need a browser session", async () => {
  const p = await testPrincipal(db);
  const ctx = (via: Principal["via"]): Context => ({ db, principal: { ...p, via } });
  await expect(call(appRouter.account.export, undefined, { context: ctx("token") })).rejects.toThrow("web app");
  await expect(call(appRouter.account.delete, { confirmEmail: "x@y.z" }, { context: ctx("oauth") })).rejects.toThrow("web app");
  const file = await call(appRouter.account.export, undefined, { context: ctx("session") });
  expect(file).toBeInstanceOf(File);
  expect((file as File).name).toMatch(/^baroka-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(await (file as File).text()).profile.id).toBe(p.userId);
});

test("disconnecting an AI app removes its consent and revokes its tokens", async () => {
  const p = await testPrincipal(db);
  const other = await testPrincipal(db, "Other");
  const clientId = await oauthConnection(p.userId);
  await oauthConnection(other.userId, clientId);
  expect((await listConnections(db, p)).connections.map((c) => c.clientId)).toEqual([clientId]);

  const res = await disconnectApp(db, p, { clientId });
  expect(res).toMatchObject({ consentsRemoved: 1, refreshTokensRevoked: 1 });
  expect((await listConnections(db, p)).connections).toEqual([]);
  const [refresh] = await db.select().from(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, p.userId));
  expect(refresh?.revoked).toBeInstanceOf(Date);
  const [access] = await db.select().from(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, p.userId));
  expect(access?.revoked).toBeInstanceOf(Date);
  // The other user's connection to the same app is untouched.
  expect((await listConnections(db, other)).connections).toHaveLength(1);
  await expect(disconnectApp(db, p, { clientId })).rejects.toThrow("not found");
});

test("an owner deletes the household with all its data after typing its name; members cannot", async () => {
  const p = await testPrincipal(db, "Dewi");
  await seedEverything(p);
  const member = await testPrincipal(db, "Budi");
  await db.insert(schema.householdMember).values({ householdId: p.householdId, userId: member.userId, role: "member" });

  await expect(deleteHousehold(db, { ...member, householdId: p.householdId }, { confirmName: "Dewi's household" })).rejects.toThrow("Only an owner");
  await expect(deleteHousehold(db, p, { confirmName: "dewi" })).rejects.toThrow("exactly");
  const res = await deleteHousehold(db, p, { confirmName: " Dewi's household " });
  expect(res.transactionsDeleted).toBe(TX_COUNT);

  for (const table of [schema.transaction, schema.finAccount, schema.category, schema.rule, schema.budget, schema.tag, schema.importBatch, schema.importMapping, schema.paymentHint, schema.householdInvite]) {
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.householdId, p.householdId));
    expect(row?.n).toBe(0);
  }
  const [tt] = await db.select({ n: count() }).from(schema.transactionTag);
  expect(tt?.n).toBe(0);
  // Both people still exist and keep their own personal households.
  expect(await db.select().from(schema.householdMember).where(eq(schema.householdMember.householdId, p.householdId))).toEqual([]);
  expect(await db.select().from(schema.user)).toHaveLength(2);
});

test("deletion plan: sole member purges, sole owner with others blocks, shared ownership leaves", () => {
  const plan = accountDeletionPlan([
    { householdId: "solo", name: "Solo", role: "owner", members: 1, owners: 1 },
    { householdId: "family", name: "Family", role: "owner", members: 3, owners: 1 },
    { householdId: "co", name: "Co-owned", role: "owner", members: 2, owners: 2 },
    { householdId: "parents", name: "Parents", role: "member", members: 2, owners: 1 },
  ]);
  expect(plan.purge.map((h) => h.householdId)).toEqual(["solo"]);
  expect(plan.blocked.map((h) => h.householdId)).toEqual(["family"]);
  expect(plan.leave.map((h) => h.householdId)).toEqual(["co", "parents"]);
});

test("deleting the account is blocked while you are the only owner of a household with other members", async () => {
  const p = await testPrincipal(db, "Dewi");
  const member = await testPrincipal(db, "Budi");
  await db.insert(schema.householdMember).values({ householdId: p.householdId, userId: member.userId, role: "member" });
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, p.userId));

  await expect(deleteAccount(db, p, { confirmEmail: "wrong@example.com" })).rejects.toThrow("email");
  await expect(deleteAccount(db, p, { confirmEmail: u!.email })).rejects.toThrow("only owner");
  expect(await db.select().from(schema.user).where(eq(schema.user.id, p.userId))).toHaveLength(1);

  // Promote Budi: now Dewi can go, and the household stays with Budi.
  await db.update(schema.householdMember).set({ role: "owner" }).where(eq(schema.householdMember.userId, member.userId));
  const res = await deleteAccount(db, p, { confirmEmail: u!.email.toUpperCase() });
  expect(res.householdsLeft).toEqual(["Dewi's household"]);
  expect(res.householdsDeleted).toEqual([]);
  expect(await db.select().from(schema.household).where(eq(schema.household.id, p.householdId))).toHaveLength(1);
});

test("deleting the account removes the user, their solo household's data, and everything tied to them", async () => {
  const p = await testPrincipal(db, "Dewi");
  const { accountId } = await seedEverything(p);
  // A shared household (co-owned) where Dewi added a transaction: it stays, without her name.
  const other = await testPrincipal(db, "Sari");
  await db.insert(schema.householdMember).values({ householdId: other.householdId, userId: p.userId, role: "owner" });
  const sharedAccount = await testAccount(db, other, "Shared");
  const [sharedTx] = await addTransactions({ ...p, householdId: other.householdId }, sharedAccount, 1);
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, p.userId));
  await db.insert(schema.waitlistSignup).values({ id: crypto.randomUUID(), email: u!.email });

  const res = await deleteAccount(db, p, { confirmEmail: u!.email });
  expect(res.householdsDeleted).toEqual(["Dewi's household"]);
  expect(res.householdsLeft).toEqual(["Sari's household"]);
  expect(res.transactionsDeleted).toBe(TX_COUNT);

  for (const [table, column] of [
    ["user", "id"],
    ["session", "user_id"],
    ["account", "user_id"],
    ["api_token", "user_id"],
    ["mcp_audit", "user_id"],
    ["oauth_consent", "user_id"],
    ["oauth_refresh_token", "user_id"],
    ["oauth_access_token", "user_id"],
    ["household_member", "user_id"],
  ] as const) {
    expect({ table, n: rowsWhere(table, column, p.userId) }).toEqual({ table, n: 0 });
  }
  for (const table of ["household_member", "fin_account", "category", "transaction", "rule", "budget", "tag", "import_batch", "import_mapping", "payment_hint", "household_invite"]) {
    expect({ table, n: rowsWhere(table, "household_id", p.householdId) }).toEqual({ table, n: 0 });
  }
  expect(rowsWhere("household", "id", p.householdId)).toBe(0);
  expect(rowsWhere("fin_account", "id", accountId)).toBe(0);
  expect(rowsWhere("waitlist_signup", "email", u!.email)).toBe(0);
  // The shared household keeps its data; the row no longer names Dewi.
  const [kept] = await db.select().from(schema.transaction).where(eq(schema.transaction.id, sharedTx!));
  expect(kept?.createdBy).toBeNull();
  expect(rowsWhere("household_member", "household_id", other.householdId)).toBe(1);
});

test("MCP audit retention deletes rows older than 90 days only", async () => {
  const p = await testPrincipal(db);
  const now = Date.UTC(2027, 0, 16);
  const row = (days: number) => ({ id: crypto.randomUUID(), userId: p.userId, clientId: "c", tool: "t", outcome: "ok", createdAt: now - days * 86_400_000 });
  await db.insert(schema.mcpAudit).values([row(1), row(89), row(91), row(400)]);
  expect(await pruneMcpAudit(db, now)).toBe(2);
  expect(await db.select().from(schema.mcpAudit)).toHaveLength(2);
});
