import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { household } from "./finance";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A member asked for support of a statement format JoyoArto cannot read yet (packages/api/src/services/statement-formats.ts).
 * Only the format's fingerprint is kept (a hash of its masked header lines), never the statement: enough to refuse
 * repeats, cap requests per member and day, and later tell requesters that their format became supported.
 */
export const statementFormatRequest = sqliteTable(
  "statement_format_request",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    /** Atur's issue id when the report reached it; null when filing failed. */
    aturIssueId: text("atur_issue_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("statement_format_request_user_idx").on(t.userId, t.createdAt), index("statement_format_request_fp_idx").on(t.fingerprint, t.householdId)],
);
