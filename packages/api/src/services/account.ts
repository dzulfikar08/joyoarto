// Data-subject rights (UU PDP 27/2022): export everything about the signed-in user and their active household,
// disconnect AI apps, delete a household's data, and delete the account itself. Session only: a token or an AI
// connection can do none of this.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { FileStore, Principal } from "../context";
import { purgeHouseholdFiles } from "./attachments";
import { exponentOf } from "../lib/money";
import { normalizeEmail } from "../lib/members";
import { badRequest, notFound } from "./common";

/** Rows per page when reading big tables: few bound parameters, bounded memory per query. */
export const EXPORT_PAGE = 1000;
/** Rows per DELETE when emptying a household, so one statement never runs for long. */
const DELETE_PAGE = 2000;
/** MCP audit rows older than this are deleted (privacy policy, retention). */
export const MCP_AUDIT_RETENTION_DAYS = 90;

const hm = schema.householdMember;
const t = schema.transaction;

/**
 * Where each table of the schema goes in the export, or why it does not. The completeness test fails when a table
 * is added to the schema without being listed here.
 */
export const EXPORT_COVERAGE: Record<string, string> = {
  user: "profile",
  account: "profile.signInMethods (provider and dates; never OAuth tokens)",
  session: "profile.sessions (dates, IP address, browser; never the session token)",
  verification: "not exported: short-lived sign-in challenges, not keyed by user",
  household: "household, memberships",
  household_member: "members, memberships",
  household_invite: "invitesSent (never the token hash)",
  fin_account: "accounts",
  category: "categories",
  import_batch: "imports",
  transaction: "transactions",
  payment_hint: "paymentHints",
  tag: "tags",
  transaction_tag: "transactions[].tags",
  rule: "rules",
  budget: "budgets",
  import_mapping: "importMappings",
  plan_scenario: "planScenarios",
  email_import_address: "emailImport (whether it is on and since when; never the address itself)",
  inbound_email: "inboundEmails",
  api_token: "apiTokens (metadata only; never the hash)",
  mcp_audit: "mcpAudit",
  joyo_conversation: "joyoConversations (yours in the active household)",
  joyo_message: "joyoConversations[].messages",
  ai_usage: "aiUsage (counts and tokens per AI call; never text)",
  oauth_consent: "connectedApps",
  oauth_client: "connectedApps[].name (and website)",
  oauth_refresh_token: "connectedApps[].lastAuthorizedAt (never the token)",
  oauth_access_token: "not exported: the MCP connector's access tokens are JWTs and are not stored",
  oauth_client_resource: "not exported: server configuration, no personal data",
  oauth_resource: "not exported: server configuration, no personal data",
  oauth_client_assertion: "not exported: unused, no personal data",
  jwks: "not exported: server signing keys",
  waitlist_signup: "not exported: not linked to accounts; deleted with the account when the email matches",
  joyo_pro_status: "billing.joyoPro (JoyoRogo's last answer about your Joyo Pro: plan, until, when it was checked)",
  usage_counter: "billing.usage (your statement imports per month)",
  attachment: "attachments (receipt photo metadata: transaction, type, size; the images themselves stay in the app, GET /api/attachments/{id})",
  reimbursement_profile: "reimbursementProfiles",
  reimbursement_claim: "reimbursementClaims (with the printed snapshot)",
  statement_format_request: "statementFormatRequests (yours: the format fingerprint and when; the statement itself was never kept)",
};

// ------------------------------------------------------------------------------------------------ export

async function* transactionPages(db: Database, householdId: string) {
  let after: { date: string; id: string } | null = null;
  for (;;) {
    const keyset: SQL | undefined = after ? or(gt(t.date, after.date), and(eq(t.date, after.date), gt(t.id, after.id))) : undefined;
    const rows = await db
      .select({
        id: t.id,
        date: t.date,
        accountId: t.accountId,
        amount: t.amount,
        currency: t.currency,
        description: t.description,
        merchant: t.merchant,
        note: t.note,
        categoryId: t.categoryId,
        categorySource: t.categorySource,
        ruleId: t.ruleId,
        balanceAfter: t.balanceAfter,
        externalRef: t.externalRef,
        paymentRef: t.paymentRef,
        importBatchId: t.importBatchId,
        status: t.status,
        capturedVia: t.capturedVia,
        capturedAt: t.capturedAt,
        clientRef: t.clientRef,
        reimburseStatus: t.reimburseStatus,
        reimburseProfileId: t.reimburseProfileId,
        reimburseClaimId: t.reimburseClaimId,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })
      .from(t)
      .where(and(eq(t.householdId, householdId), keyset))
      .orderBy(asc(t.date), asc(t.id))
      .limit(EXPORT_PAGE);
    if (!rows.length) return;
    yield rows;
    if (rows.length < EXPORT_PAGE) return;
    const last: { date: string; id: string } = rows[rows.length - 1]!;
    after = { date: last.date, id: last.id };
  }
}

/** Tag names per transaction id. Tag pairs are small (two ids); one query per household. */
async function tagsByTransaction(db: Database, householdId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ transactionId: schema.transactionTag.transactionId, name: schema.tag.name })
    .from(schema.transactionTag)
    .innerJoin(schema.tag, eq(schema.tag.id, schema.transactionTag.tagId))
    .where(eq(schema.tag.householdId, householdId));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.transactionId, [...(out.get(r.transactionId) ?? []), r.name]);
  return out;
}

async function* auditPages(db: Database, userId: string) {
  const a = schema.mcpAudit;
  let after: { createdAt: number; id: string } | null = null;
  for (;;) {
    const keyset: SQL | undefined = after ? or(gt(a.createdAt, after.createdAt), and(eq(a.createdAt, after.createdAt), gt(a.id, after.id))) : undefined;
    const rows = await db
      .select({ id: a.id, clientId: a.clientId, tool: a.tool, args: a.args, outcome: a.outcome, ms: a.ms, createdAt: a.createdAt })
      .from(a)
      .where(and(eq(a.userId, userId), keyset))
      .orderBy(asc(a.createdAt), asc(a.id))
      .limit(EXPORT_PAGE);
    if (!rows.length) return;
    yield rows.map((r) => ({ ...r, at: new Date(r.createdAt).toISOString() }));
    if (rows.length < EXPORT_PAGE) return;
    const last: { createdAt: number; id: string } = rows[rows.length - 1]!;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

/** The AI apps (OAuth clients) the user connected: from consents, plus clients that still hold a live refresh token. */
export async function listConnections(db: Database, p: Pick<Principal, "userId">) {
  const c = schema.oauthConsent;
  const r = schema.oauthRefreshToken;
  const [consents, tokens] = await db.batch([
    db
      .select({ clientId: c.clientId, scopes: c.scopes, createdAt: c.createdAt, updatedAt: c.updatedAt })
      .from(c)
      .where(eq(c.userId, p.userId))
      .orderBy(asc(c.createdAt)),
    db
      .select({ clientId: r.clientId, createdAt: r.createdAt, expiresAt: r.expiresAt })
      .from(r)
      .where(and(eq(r.userId, p.userId), isNull(r.revoked)))
      .orderBy(desc(r.createdAt)),
  ]);
  const now = Date.now();
  const ids = [...new Set([...consents.map((x) => x.clientId), ...tokens.filter((x) => x.expiresAt.getTime() > now).map((x) => x.clientId)])];
  if (!ids.length) return { connections: [] };
  const clients = new Map<string, { name: string | null; uri: string | null; icon: string | null }>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rows = await db
      .select({ clientId: schema.oauthClient.clientId, name: schema.oauthClient.name, uri: schema.oauthClient.uri, icon: schema.oauthClient.icon })
      .from(schema.oauthClient)
      .where(inArray(schema.oauthClient.clientId, part));
    for (const row of rows) clients.set(row.clientId, row);
  }
  return {
    connections: ids.map((clientId) => {
      const consent = consents.find((x) => x.clientId === clientId);
      const latest = tokens.find((x) => x.clientId === clientId);
      const client = clients.get(clientId);
      const scopes = (consent?.scopes ?? "").split(/[\s,]+/).filter(Boolean);
      return {
        clientId,
        name: client?.name || "Unnamed app",
        uri: client?.uri ?? null,
        scopes,
        /** Approved without finance:write (or no consent left): it can look but not change anything. */
        readOnly: !scopes.includes("finance:write"),
        connectedAt: consent?.createdAt ?? latest?.createdAt ?? null,
        lastAuthorizedAt: latest?.createdAt ?? null,
        hasConsent: Boolean(consent),
      };
    }),
  };
}

type ExportHeader = { generatedAt: string; householdId: string };

/**
 * Everything about the user and their active household, as JSON text in pieces (so a caller can stream it). Big
 * tables (transactions, MCP audit) are read page by page with keyset pagination; nothing is read with more than a few
 * bound parameters.
 */
export async function* exportJsonChunks(db: Database, p: Principal, now = new Date()): AsyncGenerator<string> {
  const h = p.householdId;
  const header: ExportHeader & Record<string, unknown> = {
    format: "baroka-export",
    version: 1,
    generatedAt: now.toISOString(),
    householdId: h,
    notes: [
      "Money is an integer in minor units of its currency (IDR has 2: Rp 25.000 = 2500000); negative = money out.",
      "Finance data is the active household's; other households you belong to are listed under memberships. Switch household in Settings and export again for theirs.",
      "Secrets are never exported: session tokens, API token hashes, OAuth tokens, invite token hashes.",
    ],
  };
  const [[user], signIn, sessions, memberships] = await db.batch([
    db.select().from(schema.user).where(eq(schema.user.id, p.userId)),
    db
      .select({ provider: schema.account.providerId, createdAt: schema.account.createdAt, updatedAt: schema.account.updatedAt, scope: schema.account.scope })
      .from(schema.account)
      .where(eq(schema.account.userId, p.userId)),
    db
      .select({
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, p.userId)),
    db
      .select({ householdId: hm.householdId, name: schema.household.name, role: hm.role, isDefault: hm.isDefault, joinedAt: hm.createdAt })
      .from(hm)
      .innerJoin(schema.household, eq(schema.household.id, hm.householdId))
      .where(eq(hm.userId, p.userId)),
  ]);
  if (!user) notFound("User");

  yield `${JSON.stringify(header).slice(0, -1)},`;
  const field = (name: string, value: unknown) => `${JSON.stringify(name)}:${JSON.stringify(value)},`;
  yield field("profile", {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    signInMethods: signIn,
    sessions,
  });
  yield field("memberships", memberships);

  const [[household], members, accounts, categories, rules, budgets, tags, imports, mappings, hints, scenarios, emailImport, inbound] = await db.batch([
    db.select().from(schema.household).where(eq(schema.household.id, h)),
    db
      .select({ userId: hm.userId, name: schema.user.name, email: schema.user.email, role: hm.role, joinedAt: hm.createdAt })
      .from(hm)
      .innerJoin(schema.user, eq(schema.user.id, hm.userId))
      .where(eq(hm.householdId, h)),
    db.select().from(schema.finAccount).where(eq(schema.finAccount.householdId, h)),
    db.select().from(schema.category).where(eq(schema.category.householdId, h)),
    db.select().from(schema.rule).where(eq(schema.rule.householdId, h)),
    db.select().from(schema.budget).where(eq(schema.budget.householdId, h)),
    db.select().from(schema.tag).where(eq(schema.tag.householdId, h)),
    db.select().from(schema.importBatch).where(eq(schema.importBatch.householdId, h)),
    db.select().from(schema.importMapping).where(eq(schema.importMapping.householdId, h)),
    db.select().from(schema.paymentHint).where(eq(schema.paymentHint.householdId, h)),
    db.select().from(schema.planScenario).where(eq(schema.planScenario.householdId, h)),
    db.select({ createdAt: schema.emailImportAddress.createdAt }).from(schema.emailImportAddress).where(eq(schema.emailImportAddress.householdId, h)),
    db.select().from(schema.inboundEmail).where(eq(schema.inboundEmail.householdId, h)),
  ]);
  yield field("household", household ?? null);
  yield field("members", members);
  yield field("accounts", accounts);
  yield field("categories", categories);
  yield field("rules", rules);
  yield field("budgets", budgets);
  yield field("tags", tags);
  yield field("imports", imports);
  yield field("importMappings", mappings.map((m) => ({ ...m, config: safeJson(m.config) })));
  yield field("paymentHints", hints);
  yield field("planScenarios", scenarios);
  yield field("emailImport", { enabled: emailImport.length > 0, since: emailImport[0]?.createdAt ?? null });
  yield field("inboundEmails", inbound);

  const [attachments, reimbursementProfiles, claims] = await db.batch([
    db
      .select({
        id: schema.attachment.id,
        transactionId: schema.attachment.transactionId,
        mime: schema.attachment.mime,
        size: schema.attachment.size,
        width: schema.attachment.width,
        height: schema.attachment.height,
        createdAt: schema.attachment.createdAt,
      })
      .from(schema.attachment)
      .where(eq(schema.attachment.householdId, h)),
    db.select().from(schema.reimbursementProfile).where(eq(schema.reimbursementProfile.householdId, h)),
    db.select().from(schema.reimbursementClaim).where(eq(schema.reimbursementClaim.householdId, h)),
  ]);
  yield field("attachments", attachments);
  yield field("reimbursementProfiles", reimbursementProfiles);
  yield field("reimbursementClaims", claims.map((c) => ({ ...c, snapshot: safeJson(c.snapshot) })));

  // Joyo Pro is sold by JoyoRogo; JoyoArto keeps only its last answer and this user's usage counts.
  const [joyoPro, usage] = await db.batch([
    db.select().from(schema.joyoProStatus).where(eq(schema.joyoProStatus.userId, p.userId)),
    db.select().from(schema.usageCounter).where(eq(schema.usageCounter.userId, p.userId)),
  ]);
  yield field("billing", { joyoPro: joyoPro[0] ?? null, usage });

  const inv = schema.householdInvite;
  const [invites, apiTokens] = await db.batch([
    db
      .select({
        id: inv.id,
        householdId: inv.householdId,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
        createdAt: inv.createdAt,
      })
      .from(inv)
      .where(eq(inv.invitedBy, p.userId)),
    db
      .select({
        id: schema.apiToken.id,
        name: schema.apiToken.name,
        prefix: schema.apiToken.prefix,
        scopes: schema.apiToken.scopes,
        lastUsedAt: schema.apiToken.lastUsedAt,
        expiresAt: schema.apiToken.expiresAt,
        revokedAt: schema.apiToken.revokedAt,
        createdAt: schema.apiToken.createdAt,
      })
      .from(schema.apiToken)
      .where(eq(schema.apiToken.userId, p.userId)),
  ]);
  yield field("invitesSent", invites);
  yield field("apiTokens", apiTokens);
  yield field("connectedApps", (await listConnections(db, p)).connections);

  const jc = schema.joyoConversation;
  const conversations = await db
    .select()
    .from(jc)
    .where(and(eq(jc.userId, p.userId), eq(jc.householdId, h)))
    .orderBy(asc(jc.createdAt));
  yield `"joyoConversations":[`;
  for (const [i, conv] of conversations.entries()) {
    const messages = await db
      .select({ role: schema.joyoMessage.role, content: schema.joyoMessage.content, steps: schema.joyoMessage.steps, proposals: schema.joyoMessage.proposals, model: schema.joyoMessage.model, createdAt: schema.joyoMessage.createdAt })
      .from(schema.joyoMessage)
      .where(eq(schema.joyoMessage.conversationId, conv.id))
      .orderBy(asc(schema.joyoMessage.createdAt));
    yield `${i ? "," : ""}${JSON.stringify({ ...conv, messages })}`;
  }
  yield `],`;
  const u = schema.aiUsage;
  yield field(
    "aiUsage",
    await db
      .select({ kind: u.kind, engine: u.engine, model: u.model, outcome: u.outcome, calls: u.calls, inputTokens: u.inputTokens, outputTokens: u.outputTokens, latencyMs: u.latencyMs, createdAt: u.createdAt })
      .from(u)
      .where(eq(u.userId, p.userId))
      .orderBy(asc(u.createdAt)),
  );
  const fr = schema.statementFormatRequest;
  yield field(
    "statementFormatRequests",
    await db.select({ fingerprint: fr.fingerprint, filed: sql<boolean>`${fr.aturIssueId} is not null`, createdAt: fr.createdAt }).from(fr).where(eq(fr.userId, p.userId)).orderBy(asc(fr.createdAt)),
  );

  yield `"mcpAudit":[`;
  let first = true;
  for await (const page of auditPages(db, p.userId)) {
    for (const row of page) {
      yield `${first ? "" : ","}${JSON.stringify(row)}`;
      first = false;
    }
  }
  yield `],"transactions":[`;
  const tagMap = await tagsByTransaction(db, h);
  first = true;
  for await (const page of transactionPages(db, h)) {
    yield (first ? "" : ",") + page.map((row) => JSON.stringify({ ...row, tags: tagMap.get(row.id) ?? [] })).join(",");
    first = false;
  }
  yield `]}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function collect(chunks: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of chunks) out.push(c);
  return out;
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The JSON export as a downloadable file. */
export async function exportJsonFile(db: Database, p: Principal, now = new Date()): Promise<File> {
  return new File(await collect(exportJsonChunks(db, p, now)), `baroka-export-${stamp(now)}.json`, { type: "application/json" });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Leading =, +, -, @ would run as a formula in a spreadsheet; amounts are written separately and are safe.
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** "-2500000" minor IDR -> "-25000.00": a plain decimal spreadsheets read as a number. */
export function decimalAmount(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  if (exp === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor).toString().padStart(exp + 1, "0");
  return `${sign}${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
}

export const CSV_COLUMNS = ["date", "account", "amount", "currency", "description", "merchant", "category", "note", "tags", "status", "balance_after", "id"];

/** Transactions of the active household as CSV text in pieces. */
export async function* exportCsvChunks(db: Database, p: Principal): AsyncGenerator<string> {
  const h = p.householdId;
  const [accounts, categories] = await db.batch([
    db.select({ id: schema.finAccount.id, name: schema.finAccount.name }).from(schema.finAccount).where(eq(schema.finAccount.householdId, h)),
    db.select({ id: schema.category.id, slug: schema.category.slug }).from(schema.category).where(eq(schema.category.householdId, h)),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categorySlug = new Map(categories.map((c) => [c.id, c.slug]));
  const tagMap = await tagsByTransaction(db, h);
  // A byte-order mark so Excel opens UTF-8 (merchant names with accents) correctly.
  yield `﻿${CSV_COLUMNS.join(",")}\r\n`;
  for await (const page of transactionPages(db, h)) {
    yield page
      .map(
        (r) =>
          [
            r.date,
            accountName.get(r.accountId) ?? r.accountId,
            decimalAmount(r.amount, r.currency),
            r.currency,
            r.description,
            r.merchant,
            r.categoryId ? categorySlug.get(r.categoryId) : "",
            r.note,
            (tagMap.get(r.id) ?? []).join(" "),
            r.status,
            r.balanceAfter === null ? "" : decimalAmount(r.balanceAfter, r.currency),
            r.id,
          ]
            .map((v, i) => (i === 2 || i === 10 ? (v ?? "") : csvCell(v)))
            .join(",") + "\r\n",
      )
      .join("");
  }
}

export async function exportCsvFile(db: Database, p: Principal, now = new Date()): Promise<File> {
  return new File(await collect(exportCsvChunks(db, p)), `baroka-transactions-${stamp(now)}.csv`, { type: "text/csv; charset=utf-8" });
}

// ------------------------------------------------------------------------------------------------ AI apps

export const disconnectInput = z.object({ clientId: z.string().min(1).max(200) });

/**
 * Disconnects an AI app: deletes the consent (the /mcp endpoint refuses access tokens without one, so its JWTs stop
 * working at once) and revokes its refresh and stored access tokens, so it cannot get new ones.
 */
export async function disconnectApp(db: Database, p: Pick<Principal, "userId">, input: z.infer<typeof disconnectInput>) {
  const now = new Date();
  const c = schema.oauthConsent;
  const r = schema.oauthRefreshToken;
  const a = schema.oauthAccessToken;
  const [consents, refresh] = await db.batch([
    db.delete(c).where(and(eq(c.userId, p.userId), eq(c.clientId, input.clientId))).returning({ id: c.id }),
    db.update(r).set({ revoked: now }).where(and(eq(r.userId, p.userId), eq(r.clientId, input.clientId), isNull(r.revoked))).returning({ id: r.id }),
    db.update(a).set({ revoked: now }).where(and(eq(a.userId, p.userId), eq(a.clientId, input.clientId), isNull(a.revoked))),
  ]);
  if (!consents.length && !refresh.length) notFound(`Connected app ${input.clientId}`);
  return { disconnected: input.clientId, consentsRemoved: consents.length, refreshTokensRevoked: refresh.length };
}

// ------------------------------------------------------------------------------------------------ deletion

/** Deletes a household and everything in it. Transactions first, in pages, so no single statement runs long. */
export async function purgeHousehold(db: Database, householdId: string, files?: FileStore): Promise<{ transactions: number }> {
  let transactions = 0;
  for (;;) {
    const page = db.select({ id: t.id }).from(t).where(eq(t.householdId, householdId)).limit(DELETE_PAGE);
    const gone = await db.delete(t).where(inArray(t.id, page)).returning({ id: t.id });
    transactions += gone.length;
    if (gone.length < DELETE_PAGE) break;
  }
  // Everything else hangs off household with ON DELETE CASCADE.
  await db.delete(schema.household).where(eq(schema.household.id, householdId));
  // Receipt photos live in R2 under the household's prefix; the rows went with the household.
  await purgeHouseholdFiles(files, householdId);
  return { transactions };
}

export const deleteHouseholdInput = z.object({
  confirmName: z.string().trim().min(1).max(80).describe("The household's name, typed by the user to confirm"),
});

/** An owner deletes the active household with all its finance data; every member loses access to it. */
export async function deleteHousehold(db: Database, p: Principal, input: z.infer<typeof deleteHouseholdInput>, files?: FileStore) {
  const [[h], [mine], [others]] = await db.batch([
    db.select({ id: schema.household.id, name: schema.household.name }).from(schema.household).where(eq(schema.household.id, p.householdId)),
    db
      .select({ role: hm.role })
      .from(hm)
      .where(and(eq(hm.householdId, p.householdId), eq(hm.userId, p.userId))),
    db.select({ n: count() }).from(hm).where(eq(hm.householdId, p.householdId)),
  ]);
  if (!h || !mine) notFound("Household");
  if (mine.role !== "owner") throw new ORPCError("FORBIDDEN", { message: "Only an owner can delete a household. Members can leave it." });
  if (input.confirmName.trim() !== h.name.trim()) badRequest(`Type the household's name exactly ("${h.name}") to confirm.`);
  const { transactions } = await purgeHousehold(db, h.id, files);
  // Every former member (you included) falls back to another household, or a fresh one, on the next request.
  return { deleted: h.id, name: h.name, transactionsDeleted: transactions, membersRemoved: others?.n ?? 0 };
}

/** What deleting this user's account would do to each of their households. Pure, so the guard is easy to test. */
export function accountDeletionPlan(households: { householdId: string; name: string; role: "owner" | "member"; members: number; owners: number }[]) {
  const purge = households.filter((h) => h.members <= 1);
  const blocked = households.filter((h) => h.members > 1 && h.role === "owner" && h.owners <= 1);
  const leave = households.filter((h) => h.members > 1 && !blocked.includes(h));
  return { purge, leave, blocked };
}

export const deleteAccountInput = z.object({
  confirmEmail: z.string().trim().min(3).max(254).describe("The account's email, typed by the user to confirm"),
});

async function householdsOf(db: Database, userId: string) {
  const mine = await db
    .select({ householdId: hm.householdId, name: schema.household.name, role: hm.role })
    .from(hm)
    .innerJoin(schema.household, eq(schema.household.id, hm.householdId))
    .where(eq(hm.userId, userId));
  const out = [];
  for (const h of mine) {
    const [[members], [owners]] = await db.batch([
      db.select({ n: count() }).from(hm).where(eq(hm.householdId, h.householdId)),
      db
        .select({ n: count() })
        .from(hm)
        .where(and(eq(hm.householdId, h.householdId), eq(hm.role, "owner"))),
    ]);
    out.push({ ...h, members: members?.n ?? 0, owners: owners?.n ?? 0 });
  }
  return out;
}

/** What Settings shows before deleting the account: which households go, which you leave, which block it. */
export async function accountDeletionPreview(db: Database, p: Pick<Principal, "userId">) {
  const plan = accountDeletionPlan(await householdsOf(db, p.userId));
  const brief = (h: { householdId: string; name: string; members: number }) => ({ id: h.householdId, name: h.name, members: h.members });
  return { deleted: plan.purge.map(brief), left: plan.leave.map(brief), blocking: plan.blocked.map(brief) };
}

/**
 * Deletes the user: households where they are the only member go with all their data; other memberships end. Refused
 * while they are the only owner of a household with other members (promote someone first). Sessions, API tokens,
 * AI connections, memberships and the MCP audit go with the user row (ON DELETE CASCADE); rows they created in
 * shared households stay, without their name (created_by is set to null).
 */
export async function deleteAccount(db: Database, p: Pick<Principal, "userId">, input: z.infer<typeof deleteAccountInput>, files?: FileStore) {
  const [user] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, p.userId));
  if (!user) notFound("User");
  if (normalizeEmail(input.confirmEmail) !== normalizeEmail(user.email)) badRequest("Type your account's email exactly to confirm.");

  const plan = accountDeletionPlan(await householdsOf(db, p.userId));
  if (plan.blocked.length) {
    const names = plan.blocked.map((h) => `"${h.name}"`).join(", ");
    throw new ORPCError("CONFLICT", {
      message: `You are the only owner of ${names}, which has other members. Make one of them an owner first (or remove them, or delete the household), then delete your account.`,
      data: { blocking: plan.blocked.map((h) => h.householdId) },
    });
  }
  let transactions = 0;
  for (const h of plan.purge) transactions += (await purgeHousehold(db, h.householdId, files)).transactions;

  // OAuth tokens first: access tokens point at refresh tokens without a cascade, and clients this user registered
  // may be referenced by tokens.
  await db.batch([
    db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, p.userId)),
    db.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, p.userId)),
    db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, p.userId)),
    db.delete(schema.waitlistSignup).where(eq(schema.waitlistSignup.email, normalizeEmail(user.email))),
    db.delete(schema.user).where(eq(schema.user.id, p.userId)),
  ]);
  return {
    deleted: p.userId,
    householdsDeleted: plan.purge.map((h) => h.name),
    householdsLeft: plan.leave.map((h) => h.name),
    transactionsDeleted: transactions,
  };
}

// ------------------------------------------------------------------------------------------------ retention

/** Deletes MCP audit rows older than the retention period. Returns how many went. */
export async function pruneMcpAudit(db: Database, now = Date.now()): Promise<number> {
  const cutoff = now - MCP_AUDIT_RETENTION_DAYS * 86_400_000;
  const gone = await db.delete(schema.mcpAudit).where(lt(schema.mcpAudit.createdAt, cutoff)).returning({ id: schema.mcpAudit.id });
  return gone.length;
}
