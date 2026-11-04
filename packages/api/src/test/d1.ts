// A D1 stand-in on bun:sqlite for service tests: the real migrations, foreign keys on, and D1's limit of 100 bound
// parameters per statement enforced (local SQLite would accept far more and hide the bug).

import { Database as Sqlite } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDb, schema } from "@baroka/db";
import type { Database } from "@baroka/db";

import type { Principal } from "../context";
import { ensureHousehold } from "../lib/household";

const MIGRATIONS = join(import.meta.dir, "../../../db/src/migrations");

type Bound = { sql: string; params: SQLQueryBindings[] };

function fakeD1(sqlite: Sqlite) {
  const check = (b: Bound) => {
    if (b.params.length > 100) throw new Error(`D1 limit: ${b.params.length} bound parameters in: ${b.sql.slice(0, 80)}`);
    return sqlite.query(b.sql);
  };
  const exec = (b: Bound) => {
    const q = check(b);
    if (q.columnNames.length) return { results: q.all(...b.params), success: true, meta: {} };
    const r = q.run(...b.params);
    return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  };
  const statement = (sql: string, params: SQLQueryBindings[] = []) => {
    const b: Bound = { sql, params };
    return {
      __bound: b,
      bind: (...p: unknown[]) => statement(sql, p.map((v) => (typeof v === "boolean" ? Number(v) : v)) as SQLQueryBindings[]),
      all: async () => exec(b),
      run: async () => exec(b),
      raw: async () => check(b).values(...b.params),
      first: async () => (exec(b).results as unknown[])[0] ?? null,
    };
  };
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => sqlite.transaction(() => stmts.map((s) => exec(s.__bound)))(),
    exec: async (sql: string) => sqlite.exec(sql),
    dump: async () => new ArrayBuffer(0),
  };
}

export async function testDb(): Promise<{ db: Database; sqlite: Sqlite }> {
  const sqlite = new Sqlite(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const part of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (part.trim()) sqlite.exec(part);
    }
  }
  return { db: createDb(fakeD1(sqlite) as never), sqlite };
}

export async function testPrincipal(db: Database, name = "Dewi"): Promise<Principal> {
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name, email: `${userId}@example.com` });
  const householdId = await ensureHousehold(db, userId, name);
  return { userId, householdId, scopes: ["finance:read", "finance:write"], via: "session" };
}

export async function testAccount(db: Database, p: Principal, name = "BCA") {
  const id = crypto.randomUUID();
  await db.insert(schema.finAccount).values({ id, householdId: p.householdId, name, institution: "bca", type: "bank", currency: "IDR" });
  return id;
}
