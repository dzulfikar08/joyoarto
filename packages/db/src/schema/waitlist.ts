import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * People who asked to hear when hosted baroka (Pro) opens. Public sign-ups from the landing page and the demo; not
 * tied to a user or household. No email is sent from here.
 */
export const waitlistSignup = sqliteTable("waitlist_signup", {
  id: text("id").primaryKey(),
  /** Lowercased and trimmed; one row per address. */
  email: text("email").notNull().unique(),
  name: text("name"),
  /** JSON array of bank / e-wallet slugs they use ("jago", "bca", "gopay"). */
  banks: text("banks", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Where they signed up: "landing", "demo", or a utm_source. */
  source: text("source"),
  /** utm_* query parameters as JSON. */
  utm: text("utm", { mode: "json" }).$type<Record<string, string>>(),
  locale: text("locale"),
  /** SHA-256 of the client IP with a server secret, for spotting abuse; never the IP itself. */
  ipHash: text("ip_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`).notNull(),
});
