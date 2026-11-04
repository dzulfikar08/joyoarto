// Saved Plan & simulate scenarios, shared by the household (both partners see and edit the same list).
import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import type { Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { chunk } from "../lib/d1";
import { savedPlan } from "../lib/plan/schema";
import type { SavedPlan } from "../lib/plan/schema";
import { assertScenarioSlot } from "./billing";
import { badRequest, notFound } from "./common";

const ps = schema.planScenario;
export const MAX_SCENARIOS = 50;
/** Client layout state is small (the web page's blocks); anything bigger is not layout. */
const MAX_VIEW_CHARS = 64_000;

const name = z.string().trim().min(1).max(60);

export const saveScenarioInput = z.object({
  id: z.string().max(64).optional().describe("Update this saved scenario. Without it, a scenario with the same name is replaced, or a new one is created."),
  name: name.describe("Shown in the list; unique in the household"),
  plan: savedPlan.describe("items plus any baseline overrides (monthlyIncome, monthlySpending, existingInstallments, roles, balances, startingBalances, startMonth, horizonMonths, baselineMonths, rules), as simulate_plan takes them"),
  view: z.unknown().optional().describe("Client layout state (the web page's blocks). Leave out from other clients; it is cleared when not sent."),
});
export const scenarioIdInput = z.object({ id: z.string().max(64) });

const createdByUser = alias(schema.user, "created_by_user");
const updatedByUser = alias(schema.user, "updated_by_user");

function columns() {
  return {
    id: ps.id,
    name: ps.name,
    plan: ps.plan,
    view: ps.view,
    createdAt: ps.createdAt,
    updatedAt: ps.updatedAt,
    createdById: ps.createdBy,
    createdByName: createdByUser.name,
    updatedById: ps.updatedBy,
    updatedByName: updatedByUser.name,
  };
}

type Row = { id: string; name: string; plan: unknown; view: unknown; createdAt: Date; updatedAt: Date; createdById: string | null; createdByName: string | null; updatedById: string | null; updatedByName: string | null };

function out(r: Row, withView: boolean) {
  // Rows are validated on save; parsing again applies defaults added to the schema since.
  const parsed = savedPlan.safeParse(r.plan);
  const plan = parsed.success ? parsed.data : (r.plan as SavedPlan);
  return {
    id: r.id,
    name: r.name,
    plan,
    ...(withView ? { view: r.view ?? null } : {}),
    itemCount: plan.items?.length ?? 0,
    labels: (plan.items ?? []).map((i) => i.label),
    valid: parsed.success,
    createdBy: r.createdById ? { id: r.createdById, name: r.createdByName } : null,
    updatedBy: r.updatedById ? { id: r.updatedById, name: r.updatedByName } : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function select(db: Database) {
  return db
    .select(columns())
    .from(ps)
    .leftJoin(createdByUser, eq(createdByUser.id, ps.createdBy))
    .leftJoin(updatedByUser, eq(updatedByUser.id, ps.updatedBy));
}

export async function listScenarios(db: Database, p: Principal) {
  const rows = await select(db).where(eq(ps.householdId, p.householdId)).orderBy(desc(ps.updatedAt)).limit(MAX_SCENARIOS);
  return { scenarios: rows.map((r) => out(r, false)), max: MAX_SCENARIOS };
}

export async function getScenario(db: Database, p: Principal, id: string) {
  const [row] = await select(db).where(and(eq(ps.householdId, p.householdId), eq(ps.id, id)));
  if (!row) notFound("Scenario");
  return out(row, true);
}

/** Saved plans by id, in the order asked for; unknown ids (or another household's) are an error. */
export async function scenariosByIds(db: Database, p: Principal, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = new Map<string, { id: string; name: string; plan: SavedPlan }>();
  for (const part of chunk(unique, 90)) {
    const rows = await db
      .select({ id: ps.id, name: ps.name, plan: ps.plan })
      .from(ps)
      .where(and(eq(ps.householdId, p.householdId), inArray(ps.id, part)));
    for (const r of rows) found.set(r.id, { id: r.id, name: r.name, plan: savedPlan.parse(r.plan) });
  }
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) notFound(`Saved scenario ${missing.join(", ")}`);
  return ids.map((id) => found.get(id)!);
}

export async function saveScenario(db: Database, p: Principal, input: z.infer<typeof saveScenarioInput>, billing?: BillingConfig) {
  const view = input.view === undefined ? null : input.view;
  if (view !== null && JSON.stringify(view).length > MAX_VIEW_CHARS) badRequest("view is too large.");
  const scope = eq(ps.householdId, p.householdId);
  const [byName] = await db.select({ id: ps.id }).from(ps).where(and(scope, eq(ps.name, input.name)));
  let id = input.id;
  if (id) {
    const [row] = await db.select({ id: ps.id }).from(ps).where(and(scope, eq(ps.id, id)));
    if (!row) notFound("Scenario");
    if (byName && byName.id !== id) throw new ORPCError("CONFLICT", { message: `Another saved scenario is already called "${input.name}".` });
  } else id = byName?.id;

  const values = { name: input.name, plan: input.plan as unknown as Record<string, unknown>, view, updatedBy: p.userId };
  if (id) {
    await db
      .update(ps)
      .set({ ...values, updatedAt: new Date() })
      .where(and(scope, eq(ps.id, id)));
    return { created: false, scenario: await getScenario(db, p, id) };
  }
  const count = (await db.select({ id: ps.id }).from(ps).where(scope).limit(MAX_SCENARIOS)).length;
  await assertScenarioSlot(db, p.userId, billing, count);
  if (count >= MAX_SCENARIOS) badRequest(`A household can keep at most ${MAX_SCENARIOS} saved scenarios; delete some first.`);
  const newId = crypto.randomUUID();
  await db.insert(ps).values({ id: newId, householdId: p.householdId, createdBy: p.userId, ...values });
  return { created: true, scenario: await getScenario(db, p, newId) };
}

export async function deleteScenario(db: Database, p: Principal, id: string) {
  const deleted = await db
    .delete(ps)
    .where(and(eq(ps.householdId, p.householdId), eq(ps.id, id)))
    .returning({ id: ps.id });
  if (!deleted.length) notFound("Scenario");
  return { deleted: true, id };
}
