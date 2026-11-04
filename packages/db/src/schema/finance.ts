import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Money is always an integer in minor units of `currency` (ISO 4217 exponent: IDR 2, so Rp 12.500 is 1250000).
// Transaction amounts are signed from the account's point of view: negative = money out, positive = money in.
// Dates of transactions are calendar days as the bank prints them (YYYY-MM-DD), never instants.
//
// Every finance row belongs to a household, not a user. Each user gets a personal household on first use
// (packages/api/src/lib/household.ts); invites add family members to an existing one.

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull();

export const household = sqliteTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Currency summaries are reported in. */
  baseCurrency: text("base_currency").notNull().default("IDR"),
  createdAt: createdAt(),
});

export const HOUSEHOLD_ROLES = ["owner", "member"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const householdMember = sqliteTable(
  "household_member",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** owner: everything, including members. member: read and write finance data. */
    role: text("role", { enum: HOUSEHOLD_ROLES }).notNull(),
    /** The household this user acts in (web app, API tokens, AI connections). Exactly one per user. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    index("household_member_user_idx").on(t.userId),
    uniqueIndex("household_member_default_uidx").on(t.userId).where(sql`is_default = 1`),
  ],
);

/**
 * An invitation to join a household, bound to one email address. The link (/join/<token>) is shown once to the
 * owner; only a SHA-256 hash of the token is stored. A pending, unexpired invite also lets that email sign up.
 */
export const householdInvite = sqliteTable(
  "household_invite",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** Lower-case. */
    email: text("email").notNull(),
    role: text("role", { enum: HOUSEHOLD_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("household_invite_household_idx").on(t.householdId), index("household_invite_email_idx").on(t.email)],
);

export const ACCOUNT_TYPES = ["bank", "credit_card", "ewallet", "cash", "investment", "loan", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const finAccount = sqliteTable(
  "fin_account",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** bca, mandiri, jago, jenius, gopay, ovo, dana, shopeepay, cash, other: picks the import preset. */
    institution: text("institution").notNull().default("other"),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    currency: text("currency").notNull().default("IDR"),
    /** Last digits of the account or card number, to tell statements apart. */
    last4: text("last4"),
    openingBalance: integer("opening_balance").notNull().default(0),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("fin_account_household_idx").on(t.householdId)],
);

export const CATEGORY_KINDS = ["expense", "income", "transfer"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** Stable lower-case key ("food", "food/groceries"): what rules, imports and the AI refer to. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    kind: text("kind", { enum: CATEGORY_KINDS }).notNull(),
    icon: text("icon"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_household_slug_uidx").on(t.householdId, t.slug)],
);

export const CATEGORY_SOURCES = ["manual", "rule", "import"] as const;

/** posted: from a statement or entered as final. pending: quick capture (phone, Shortcut, voice) a statement confirms. */
export const TRANSACTION_STATUSES = ["posted", "pending"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const CAPTURE_SOURCES = ["manual", "shortcut", "notification", "voice", "mcp", "api", "joyo"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const importBatch = sqliteTable(
  "import_batch",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => finAccount.id, { onDelete: "cascade" }),
    /** csv, xlsx, pdf (read in the app or uploaded), email (statement PDF sent to the import address), mcp (rows an AI parsed from a statement), api. */
    source: text("source").notNull(),
    fileName: text("file_name"),
    /** R2 key of the original file, when one was uploaded. */
    fileKey: text("file_key"),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("import_batch_household_idx").on(t.householdId, t.createdAt)],
);

export const transaction = sqliteTable(
  "transaction",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => finAccount.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    /** Signed minor units: negative = out. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /** Exactly what the bank printed. Never edited. */
    description: text("description").notNull(),
    /** Cleaned-up counterparty ("Indomaret", "Gojek"); editable, rules may set it. */
    merchant: text("merchant"),
    note: text("note"),
    categoryId: text("category_id").references(() => category.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }),
    ruleId: text("rule_id"),
    /** Running balance the statement printed after this row, when it had one. */
    balanceAfter: integer("balance_after"),
    /** Bank's own reference number, when the statement has one. */
    externalRef: text("external_ref"),
    /** A payment app's own id for this payment (GoPay id on a Jago "Payment with Jago Pay"), to merge its details in. */
    paymentRef: text("payment_ref"),
    /** Hash of account, date, amount, description and occurrence: re-importing a statement adds nothing. */
    dedupeKey: text("dedupe_key").notNull(),
    importBatchId: text("import_batch_id").references(() => importBatch.id, { onDelete: "set null" }),
    /**
     * pending rows are provisional (quick add); the next statement import replaces each with the matching statement
     * row (packages/api/src/lib/reconcile.ts). Both count in reports right away.
     */
    status: text("status", { enum: TRANSACTION_STATUSES }).notNull().default("posted"),
    /** How a quick-add row was captured; kept on the statement row that replaces it. */
    capturedVia: text("captured_via", { enum: CAPTURE_SOURCES }),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
    /** Client-chosen id of a quick add, unique per household, so a phone retrying a request adds nothing twice. */
    clientRef: text("client_ref"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("transaction_account_dedupe_uidx").on(t.accountId, t.dedupeKey),
    index("transaction_household_date_idx").on(t.householdId, t.date),
    index("transaction_account_date_idx").on(t.accountId, t.date),
    index("transaction_household_category_idx").on(t.householdId, t.categoryId, t.date),
    index("transaction_household_merchant_idx").on(t.householdId, t.merchant),
    index("transaction_batch_idx").on(t.importBatchId),
    index("transaction_household_payment_ref_idx").on(t.householdId, t.paymentRef),
    index("transaction_account_status_date_idx").on(t.accountId, t.status, t.date),
    uniqueIndex("transaction_household_client_ref_uidx").on(t.householdId, t.clientRef).where(sql`client_ref is not null`),
  ],
);

/**
 * What a payment app's history says about a payment (GoPay: the real merchant behind "Gopay - Generic" on a Jago
 * statement). Stored on its own so the two statements can be imported in either order.
 */
export const paymentHint = sqliteTable(
  "payment_hint",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** gopay, ... */
    source: text("source").notNull(),
    ref: text("ref").notNull(),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    merchant: text("merchant").notNull(),
    /** Suggested category slug, or null when the name does not tell. */
    category: text("category"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.ref] })],
);

export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tag_household_name_uidx").on(t.householdId, t.name)],
);

export const transactionTag = sqliteTable(
  "transaction_tag",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transaction.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] }), index("transaction_tag_tag_idx").on(t.tagId)],
);

export const RULE_FIELDS = ["merchant", "description"] as const;
export const RULE_MATCHES = ["contains", "equals", "starts_with"] as const;
export const RULE_DIRECTIONS = ["in", "out"] as const;

/** Auto-categorisation: the first enabled rule (lowest priority number) that matches a new transaction wins. */
export const rule = sqliteTable(
  "rule",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    field: text("field", { enum: RULE_FIELDS }).notNull(),
    match: text("match", { enum: RULE_MATCHES }).notNull(),
    /** Compared case-insensitively. */
    pattern: text("pattern").notNull(),
    accountId: text("account_id").references(() => finAccount.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: RULE_DIRECTIONS }),
    /** Absolute amount bounds, minor units, inclusive. */
    minAmount: integer("min_amount"),
    maxAmount: integer("max_amount"),
    setCategoryId: text("set_category_id").references(() => category.id, { onDelete: "cascade" }),
    setMerchant: text("set_merchant"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("rule_household_idx").on(t.householdId, t.priority)],
);

/** A monthly spending limit for one expense category (its subcategories count toward it). */
export const budget = sqliteTable(
  "budget",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    /** Positive minor units per month, in the household's base currency. */
    amount: integer("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("budget_household_category_uidx").on(t.householdId, t.categoryId)],
);

/** Saved column mapping of a CSV/XLSX layout, so the next statement from that bank imports in one step. */
export const importMapping = sqliteTable(
  "import_mapping",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    institution: text("institution").notNull().default("other"),
    /** JSON of CsvMapping (packages/api/src/lib/csv.ts). */
    config: text("config").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("import_mapping_household_idx").on(t.householdId)],
);

/** Personal access tokens for scripts, the CLI and Claude Code. Only a SHA-256 hash of the token is stored. */
export const apiToken = sqliteTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters of the token, shown so the owner can tell tokens apart. */
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** Space-separated: finance:read finance:write. */
    scopes: text("scopes").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("api_token_user_idx").on(t.userId)],
);

/** One row per MCP tool call: who, through which client, which tool, how it ended. Arguments only, never results. */
export const mcpAudit = sqliteTable(
  "mcp_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    tool: text("tool").notNull(),
    args: text("args"),
    outcome: text("outcome").notNull(),
    ms: integer("ms").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("mcp_audit_user_created_idx").on(t.userId, t.createdAt)],
);
