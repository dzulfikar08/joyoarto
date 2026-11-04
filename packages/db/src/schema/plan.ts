import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { household } from "./finance";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A saved Plan & simulate scenario, shared by everyone in the household. `plan` is the planner's input (baseline
 * overrides and scenario items, validated by `savedPlan` in packages/api/src/lib/plan/schema.ts); `view` is optional
 * client layout state (the web page's blocks), ignored by the server and dropped when it no longer matches the items.
 */
export const planScenario = sqliteTable(
  "plan_scenario",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    plan: text("plan", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    view: text("view", { mode: "json" }).$type<unknown>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("plan_scenario_household_name_uidx").on(t.householdId, t.name), index("plan_scenario_household_updated_idx").on(t.householdId, t.updatedAt)],
);
