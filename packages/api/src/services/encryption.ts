// Encrypting rows written before DATA_KEY was set (docs/operator-access.md). An operator calls
// POST /api/admin/encryption/backfill until `done`; each call seals up to `limit` plaintext values per column and moves
// up to `files` receipt photos to sealed objects. Safe to re-run and to run while members use the app: a value is only
// replaced when it is still the plaintext that was read, and sealed values are never selected again. The answer holds
// counts only, never data.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, eq, getTableColumns, getTableName, like, not, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import type { FileStore } from "../context";
import { currentKeyId, dataKeyEnabled, sealBytes, sealText } from "../lib/data-key";
import { ENC_PREFIX, isEncryptedBytes } from "../lib/field-crypto";
import { SEALED_SUFFIX } from "./attachments";

type Target = { table: SQLiteTable; id: SQLiteColumn; column: SQLiteColumn; json?: boolean };

const t = schema.transaction;
const jc = schema.joyoConversation;
const jm = schema.joyoMessage;
const rp = schema.reimbursementProfile;
const rc = schema.reimbursementClaim;
const ie = schema.inboundEmail;
const ib = schema.importBatch;
const ps = schema.planScenario;
const ma = schema.mcpAudit;

/**
 * Every database column sealed at rest. The services seal these on write and open them on read; a column added here
 * must be handled there too (services/encryption.test.ts checks a round trip through the API for each).
 */
export const ENCRYPTED_COLUMNS: Target[] = [
  { table: t, id: t.id, column: t.note },
  { table: jc, id: jc.id, column: jc.title },
  { table: jm, id: jm.id, column: jm.content },
  { table: jm, id: jm.id, column: jm.steps, json: true },
  { table: jm, id: jm.id, column: jm.proposals, json: true },
  { table: rp, id: rp.id, column: rp.claimantName },
  { table: rp, id: rp.id, column: rp.employeeId },
  { table: rp, id: rp.id, column: rp.department },
  { table: rp, id: rp.id, column: rp.approverName },
  { table: rp, id: rp.id, column: rp.approverEmail },
  { table: rc, id: rc.id, column: rc.notes },
  { table: rc, id: rc.id, column: rc.snapshot },
  { table: ie, id: ie.id, column: ie.subject },
  { table: ie, id: ie.id, column: ie.detail, json: true },
  { table: ib, id: ib.id, column: ib.fileName },
  { table: ps, id: ps.id, column: ps.plan, json: true },
  { table: ps, id: ps.id, column: ps.view, json: true },
  { table: ma, id: ma.id, column: ma.args },
];

export const columnName = (x: Target) => `${getTableName(x.table)}.${x.column.name}`;

/** Rows of a target that still hold plaintext. JSON columns store a sealed value as a JSON string: "enc:v1:…". */
function plaintext(x: Target): SQL {
  const sealed = x.json ? `"${ENC_PREFIX}%` : `${ENC_PREFIX}%`;
  return and(sql`${x.column} is not null`, sql`${x.column} <> ''`, x.json ? sql`${x.column} <> 'null'` : undefined, not(like(x.column, sealed)))!;
}

export const backfillInput = z.object({
  limit: z.number().int().min(0).max(200).default(100).describe("Values per column this call (0 = only count what is left)"),
  files: z.number().int().min(0).max(25).default(10).describe("Receipt photos this call"),
});

export type BackfillResult = {
  keyId: string;
  /** Values sealed by this call, per table.column (and receipt files). */
  encrypted: Record<string, number>;
  /** Plaintext values left after this call. */
  remaining: Record<string, number>;
  /** Photos whose object was already missing from R2 (their rows are marked; they still answer 404). */
  missingFiles: number;
  done: boolean;
};

async function sealColumn(db: Database, x: Target, limit: number): Promise<number> {
  if (!limit) return 0;
  const rows = await db.all<{ id: string; v: string }>(sql`select ${x.id} as id, ${x.column} as v from ${x.table} where ${plaintext(x)} limit ${limit}`);
  if (!rows.length) return 0;
  const key = Object.entries(getTableColumns(x.table)).find(([, c]) => c === x.column)![0];
  // A JSON column holds JSON text; its sealed form is that text encrypted, which drizzle stores as a JSON string.
  const sealed = await Promise.all(rows.map((r) => sealText(r.v)));
  // Only while it is still the value read here (compared as stored): an edit made meanwhile is not overwritten, and
  // was sealed when it was written. Built, not awaited: a drizzle query runs when awaited; these run in one batch.
  const updates = rows.map((r, i) =>
    db
      .update(x.table)
      .set({ [key]: sealed[i] })
      .where(and(sql`${x.id} = ${r.id}`, sql`${x.column} = ${r.v}`)),
  );
  // One batch per column: a call stays far below the Worker's limit on D1 queries per invocation.
  await db.batch(updates as unknown as Parameters<typeof db.batch>[0]);
  return rows.length;
}

async function countPlain(db: Database, x: Target): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`select count(*) as n from ${x.table} where ${plaintext(x)}`);
  return Number(row?.n ?? 0);
}

const at = schema.attachment;

/** Receipt photos stored before DATA_KEY: each is sealed into a new object (<key>.enc), the row moved, the old one removed. */
async function sealFiles(db: Database, files: FileStore, limit: number): Promise<{ sealed: number; missing: number }> {
  if (!limit) return { sealed: 0, missing: 0 };
  const rows = await db
    .select({ id: at.id, key: at.r2Key })
    .from(at)
    .where(not(like(at.r2Key, `%${SEALED_SUFFIX}`)))
    .limit(limit);
  let sealed = 0;
  let missing = 0;
  for (const r of rows) {
    const obj = await files.get(r.key);
    const target = `${r.key}${SEALED_SUFFIX}`;
    if (!obj) {
      // Nothing to seal (the photo answers 404 either way); the row is marked so it is not picked again.
      await db.update(at).set({ r2Key: target }).where(and(eq(at.id, r.id), eq(at.r2Key, r.key)));
      missing++;
      continue;
    }
    await files.put(target, isEncryptedBytes(obj.body) ? obj.body : await sealBytes(obj.body), "application/octet-stream");
    const moved = await db
      .update(at)
      .set({ r2Key: target })
      .where(and(eq(at.id, r.id), eq(at.r2Key, r.key)))
      .returning({ id: at.id });
    // The row went away (photo deleted meanwhile) or moved already: drop the copy, keep whatever the row points at.
    await files.delete(moved.length ? [r.key] : [target]);
    if (moved.length) sealed++;
  }
  return { sealed, missing };
}

async function plainFiles(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(at)
    .where(not(like(at.r2Key, `%${SEALED_SUFFIX}`)));
  return Number(row?.n ?? 0);
}

export async function backfill(db: Database, files: FileStore | undefined, input: z.infer<typeof backfillInput>): Promise<BackfillResult> {
  if (!dataKeyEnabled()) throw new ORPCError("PRECONDITION_FAILED", { message: "DATA_KEY is not set on this server: nothing is encrypted." });
  const keyId = (await currentKeyId())!;
  const encrypted: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  for (const x of ENCRYPTED_COLUMNS) {
    const name = columnName(x);
    encrypted[name] = await sealColumn(db, x, input.limit);
    remaining[name] = await countPlain(db, x);
  }
  let missingFiles = 0;
  if (files) {
    const f = await sealFiles(db, files, input.files);
    encrypted["attachment.file"] = f.sealed;
    missingFiles = f.missing;
    remaining["attachment.file"] = await plainFiles(db);
  }
  const done = Object.values(remaining).every((n) => n === 0);
  return { keyId, encrypted, remaining, missingFiles, done };
}
