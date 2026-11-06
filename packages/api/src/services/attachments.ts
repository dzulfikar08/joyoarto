// Receipt photos kept as proof. The bytes live in R2 (context.files) under h/<householdId>/r/<id>; the attachment
// row says which household and transaction they belong to. Photos are only ever served through
// GET /api/attachments/{id} to members of that household: there are no public URLs. Deleting a transaction, undoing
// the import that added it, or deleting the household removes the files too.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import type { FileStore, Principal } from "../context";
import { chunk } from "../lib/d1";
import { dataKeyEnabled, sealBytes, unsealBytes } from "../lib/data-key";
import { MAX_RECEIPT_BYTES, imageSize } from "../lib/receipt";
import { badRequest, notFound } from "./common";

const at = schema.attachment;
const t = schema.transaction;

/** Photos per transaction (a long receipt in two shots, an invoice and its payment proof). */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;
/** Uploads never attached to a transaction (the add sheet was closed) are removed after this. */
export const ORPHAN_AFTER_MS = 24 * 3_600_000;

export function householdPrefix(householdId: string): string {
  return `h/${householdId}/`;
}

/** Objects stored encrypted (DATA_KEY) end in this, so the backfill finds plain ones from the rows alone. */
export const SEALED_SUFFIX = ".enc";

export function receiptKey(householdId: string, id: string, sealed = false): string {
  return `${householdPrefix(householdId)}r/${id}${sealed ? SEALED_SUFFIX : ""}`;
}

export function requireFiles(files: FileStore | undefined): FileStore {
  if (!files) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Receipt photos are not set up on this server.", data: { reason: "off" } });
  return files;
}

export type AttachmentView = { id: string; transactionId: string | null; mime: string; size: number; width: number | null; height: number | null; createdAt: string };

function view(r: typeof at.$inferSelect): AttachmentView {
  return { id: r.id, transactionId: r.transactionId, mime: r.mime, size: r.size, width: r.width, height: r.height, createdAt: r.createdAt.toISOString() };
}

/** Checks and stores one image. The bytes must really be a JPEG or PNG (the header is read, the client's type is not trusted). */
export async function storeImage(db: Database, files: FileStore, p: Principal, bytes: Uint8Array, transactionId: string | null): Promise<AttachmentView> {
  if (bytes.byteLength > MAX_RECEIPT_BYTES) badRequest("The photo is too large (at most 5 MB).");
  const info = imageSize(bytes);
  if (!info) badRequest("Send a JPEG or PNG photo.");
  const id = crypto.randomUUID();
  const sealed = dataKeyEnabled();
  const key = receiptKey(p.householdId, id, sealed);
  // Sealed objects are opaque bytes in R2; the row keeps the photo's real type for serving.
  await files.put(key, sealed ? await sealBytes(bytes) : bytes, sealed ? "application/octet-stream" : info.mime);
  const row = { id, householdId: p.householdId, transactionId, r2Key: key, mime: info.mime, size: bytes.byteLength, width: info.width || null, height: info.height || null, createdBy: p.userId };
  try {
    await db.insert(at).values(row);
  } catch (error) {
    await files.delete([key]).catch(() => {});
    throw error;
  }
  const [saved] = await db.select().from(at).where(eq(at.id, id));
  return view(saved!);
}

export const uploadInput = z.object({
  file: z.file().max(MAX_RECEIPT_BYTES).describe("The photo (JPEG or PNG, at most 5 MB; the apps send a JPEG about 1600 px on the long side)"),
  transactionId: z.string().optional().describe("Attach to this transaction; absent = keep it unattached until a quick add saves it (attachmentIds)"),
  replace: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true")
    .describe("Remove the transaction's other photos"),
});

async function ownTransaction(db: Database, householdId: string, id: string) {
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.id, id), eq(t.householdId, householdId)));
  return row ?? notFound(`Transaction ${id}`);
}

/** A photo for a transaction (or for the add sheet before Save). */
export async function uploadAttachment(db: Database, files: FileStore | undefined, p: Principal, input: z.infer<typeof uploadInput>) {
  const store = requireFiles(files);
  if (input.transactionId) {
    await ownTransaction(db, p.householdId, input.transactionId);
    if (input.replace) await purgeTransactionFiles(db, store, p.householdId, [input.transactionId]);
    else {
      const existing = await db.select({ id: at.id }).from(at).where(eq(at.transactionId, input.transactionId));
      if (existing.length >= MAX_ATTACHMENTS_PER_TRANSACTION) badRequest(`A transaction can keep at most ${MAX_ATTACHMENTS_PER_TRANSACTION} photos.`);
    }
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  return { attachment: await storeImage(db, store, p, bytes, input.transactionId ?? null) };
}

async function ownAttachment(db: Database, householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(at)
    .where(and(eq(at.id, id), eq(at.householdId, householdId)));
  return row ?? notFound(`Photo ${id}`);
}

/** The image itself, for members of its household only. */
export async function getAttachmentFile(db: Database, files: FileStore | undefined, p: Principal, id: string): Promise<File> {
  const store = requireFiles(files);
  const row = await ownAttachment(db, p.householdId, id);
  const obj = await store.get(row.r2Key);
  if (!obj) notFound(`Photo ${id}`);
  const body = await unsealBytes(obj.body);
  return new File([body as unknown as ArrayBuffer], `${row.id}.${row.mime === "image/png" ? "png" : "jpg"}`, { type: row.mime });
}

export async function deleteAttachment(db: Database, files: FileStore | undefined, p: Principal, id: string) {
  const row = await ownAttachment(db, p.householdId, id);
  await db.delete(at).where(eq(at.id, row.id));
  if (files) await files.delete([row.r2Key]);
  return { deleted: row.id };
}

/** Uploaded photos (unattached, same household) become the transaction's. Returns how many were attached. */
export async function attachToTransaction(db: Database, householdId: string, ids: readonly string[], transactionId: string): Promise<number> {
  if (!ids.length) return 0;
  const res = await db
    .update(at)
    .set({ transactionId })
    .where(and(eq(at.householdId, householdId), isNull(at.transactionId), inArray(at.id, ids.slice(0, MAX_ATTACHMENTS_PER_TRANSACTION))))
    .returning({ id: at.id });
  return res.length;
}

/** Photo ids per transaction, oldest first. */
export async function attachmentsByTransaction(db: Database, householdId: string, txIds: readonly string[]): Promise<Map<string, AttachmentView[]>> {
  const out = new Map<string, AttachmentView[]>();
  for (const part of chunk([...new Set(txIds)], 90)) {
    const rows = await db
      .select()
      .from(at)
      .where(and(eq(at.householdId, householdId), inArray(at.transactionId, part)))
      .orderBy(asc(at.createdAt));
    for (const r of rows) {
      const list = out.get(r.transactionId!) ?? [];
      list.push(view(r));
      out.set(r.transactionId!, list);
    }
  }
  return out;
}

/** Before transactions are deleted: their photos' rows and files go first (the row cascade alone would leave the files). */
export async function purgeTransactionFiles(db: Database, files: FileStore | undefined, householdId: string, txIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const part of chunk([...new Set(txIds)], 90)) {
    const found = await db
      .select({ id: at.id, key: at.r2Key })
      .from(at)
      .where(and(eq(at.householdId, householdId), inArray(at.transactionId, part)));
    if (!found.length) continue;
    // Objects first: if R2 fails the rows stay (and the error stops the caller), so no object loses its row.
    if (files) await files.delete(found.map((g) => g.key));
    const gone = await db
      .delete(at)
      .where(and(eq(at.householdId, householdId), inArray(at.id, found.map((g) => g.id))))
      .returning({ id: at.id });
    removed += gone.length;
  }
  return removed;
}

/** Every file of a household (after the household itself is deleted). */
export async function purgeHouseholdFiles(files: FileStore | undefined, householdId: string): Promise<number> {
  if (!files) return 0;
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await files.list(householdPrefix(householdId), cursor);
    if (page.keys.length) await files.delete(page.keys);
    removed += page.keys.length;
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return removed;
}

/** Daily: uploads the add sheet never saved. */
export async function sweepOrphanAttachments(db: Database, files: FileStore | undefined, now = Date.now()): Promise<number> {
  const found = await db
    .select({ id: at.id, key: at.r2Key })
    .from(at)
    .where(and(isNull(at.transactionId), lt(at.createdAt, new Date(now - ORPHAN_AFTER_MS))))
    .limit(500);
  // R2 first, then only the rows whose objects are gone: when R2 fails, the rows stay for the next night's sweep.
  let removed = 0;
  for (const part of chunk(found, 90)) {
    if (files) {
      try {
        await files.delete(part.map((g) => g.key));
      } catch (error) {
        console.error("orphan receipts: R2 delete failed", error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    const gone = await db
      .delete(at)
      .where(and(inArray(at.id, part.map((g) => g.id)), isNull(at.transactionId)))
      .returning({ id: at.id });
    removed += gone.length;
  }
  return removed;
}

/** An in-memory FileStore (tests, local dev without R2). */
export function memoryFileStore(): FileStore & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key, body, contentType) => void objects.set(key, { body, contentType }),
    get: async (key) => objects.get(key) ?? null,
    delete: async (keys) => keys.forEach((k) => objects.delete(k)),
    list: async (prefix) => ({ keys: [...objects.keys()].filter((k) => k.startsWith(prefix)), cursor: null }),
  };
}
