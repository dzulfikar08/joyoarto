import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { household } from "./finance";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A household's private import address (`import+<token>@<domain>`, see packages/api/src/services/inbound.ts). Mail
 * to it from a member's own address is read and its statement PDFs imported. No row = email import is off. The token
 * is stored as is because the Settings page shows the address; regenerating replaces it.
 */
export const emailImportAddress = sqliteTable("email_import_address", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => household.id, { onDelete: "cascade" }),
  /** 26 characters of base32 (130 bits), lower-case. */
  token: text("token").notNull().unique(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
});

export const INBOUND_STATUSES = ["imported", "partial", "failed", "no_pdf", "rejected_sender", "forwarding_confirmation"] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/**
 * One row per email that reached a valid import address: who sent it, what came of it. The import batches it created
 * (import_batch, source "email") are the transactions' own log; this keeps the emails that imported nothing too.
 * Never the message body or attachments.
 */
export const inboundEmail = sqliteTable(
  "inbound_email",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    /** Envelope sender, lower-case. */
    fromAddress: text("from_address").notNull(),
    /** Member it was matched to; null when the sender is not a member. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    subject: text("subject"),
    status: text("status", { enum: INBOUND_STATUSES }).notNull(),
    /** JSON: per attachment { name, kind, ok, message, newRows, duplicates, ... }, or the confirmation code. */
    detail: text("detail", { mode: "json" }).$type<unknown>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("inbound_email_household_created_idx").on(t.householdId, t.createdAt)],
);
