import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { household } from "./finance";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A Joyo AI chat. Private to the member who wrote it (not shared with the rest of the household), and kept with the
 * household it was about: switching households shows that household's chats. Deleted with either.
 */
export const joyoConversation = sqliteTable(
  "joyo_conversation",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("joyo_conversation_user_idx").on(t.userId, t.householdId, t.updatedAt)],
);

/**
 * One turn of a chat. `steps` are the tools an answer read (names and plain arguments, never their results);
 * `proposals` are changes the answer suggested (a quick add, a category, a scenario), each run only when the member
 * confirms it, with its status.
 */
export const joyoMessage = sqliteTable(
  "joyo_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => joyoConversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    steps: text("steps", { mode: "json" }).$type<unknown[]>(),
    proposals: text("proposals", { mode: "json" }).$type<unknown[]>(),
    /** Which engine and model wrote an assistant turn ("hosted:claude-opus-5-5", "byok:anthropic:..."). */
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [index("joyo_message_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * AI calls made on JoyoArto's account (the daily cap counts these) and with a member's own key: counts and tokens
 * only, never what was asked, said or answered.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    householdId: text("household_id").references(() => household.id, { onDelete: "cascade" }),
    /** chat (Joyo AI), transcribe (voice note to text), parse (text to a transaction draft), receipt, format (a statement format request's parser spec). */
    kind: text("kind", { enum: ["chat", "transcribe", "parse", "receipt", "format"] }).notNull(),
    /** hosted = JoyoArto's key or Workers AI; byok = the member's own key (not counted in the cap). */
    engine: text("engine", { enum: ["hosted", "byok"] }).notNull(),
    model: text("model").notNull(),
    /** pending until the call ends, then ok, error kind or aborted. */
    outcome: text("outcome").notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("ai_usage_user_kind_idx").on(t.userId, t.kind, t.createdAt)],
);
