import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Joyo Pro is one subscription per ACCOUNT, shared by JoyoRogo, JoyoFit and JoyoArto. JoyoRogo's server is the only
// billing authority: JoyoArto sells nothing, holds no payment credentials and gets no payment webhooks. It asks
// JoyoRogo whether a user is Pro (packages/api/src/lib/billing/joyo-pro.ts) and caches the answer here.
//
// Free, trial and grandfathered Pro need no rows: they follow from the user's age and the server's billing config.

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** JoyoRogo's last answer for a user. Pro answers are trusted for ~10 minutes, not-Pro for ~2 (see JOYO_PRO_CACHE_MS). */
export const joyoProStatus = sqliteTable("joyo_pro_status", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  pro: integer("pro", { mode: "boolean" }).notNull(),
  /** Pro until (null with pro = no end, e.g. lifetime). */
  until: integer("until", { mode: "timestamp_ms" }),
  /** monthly | yearly | lifetime (JoyoRogo's words); null when not Pro. */
  plan: text("plan"),
  /** Where JoyoRogo says it was bought (doku, polar, google, apple, comp...): shown in Settings, never trusted for access. */
  source: text("source"),
  /** Last successful answer. */
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
  /** Ask JoyoRogo again after this. */
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  /**
   * The latest Pro end JoyoRogo ever confirmed (kept when a later answer says not-Pro). While JoyoRogo is unreachable a
   * user stays Pro for at most 24 h past it; a user who was never Pro gets nothing.
   */
  lastProUntil: integer("last_pro_until", { mode: "timestamp_ms" }),
  /** 1 when JoyoRogo once confirmed Pro with no end (lifetime). */
  lastProLifetime: integer("last_pro_lifetime", { mode: "boolean" }).notNull().default(false),
});

/** Metered Free limits per user and period (metric "statement_import", period "YYYY-MM" in WIB). */
export const usageCounter = sqliteTable(
  "usage_counter",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.metric, t.period] })],
);
