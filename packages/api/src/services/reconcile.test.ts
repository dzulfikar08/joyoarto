import { beforeEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { eq } from "drizzle-orm";

import type { Principal } from "../context";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { dashboard } from "./dashboard";
import { importTransactions, undoImport } from "./imports";
import type { ImportRow } from "./imports";
import { quickAdd, quickAddInput, searchTransactions, updateTransaction } from "./transactions";

let db: Database;
let p: Principal;
let bca: string;

beforeEach(async () => {
  ({ db } = await testDb());
  p = await testPrincipal(db);
  bca = await testAccount(db, p, "BCA");
});

const quick = (input: Partial<ReturnType<typeof quickAddInput.parse>>) => quickAdd(db, p, quickAddInput.parse(input));
const importRows = (accountId: string, rows: ImportRow[], commit: boolean) =>
  importTransactions(db, p, { accountId, rows, commit, source: "api", previewLimit: 50 });

test("quick add: amount text, pending, rules and an explicit category", async () => {
  const r = await quick({ accountId: bca, amountText: "25rb", description: "Kopi Kenangan", category: "food", occurredAt: "2026-11-03T08:00:00+07:00" });
  expect(r.created).toBe(true);
  expect(r.transaction).toMatchObject({ amount: -2500000, status: "pending", date: "2026-11-03", category: "food", capturedVia: "manual", merchant: "Kopi Kenangan" });
  // An instant late on the 2nd in UTC is the 3rd in WIB.
  const late = await quick({ accountId: bca, amount: 100000, description: "refund", occurredAt: "2026-11-02T20:00:00Z" });
  expect(late.transaction.date).toBe("2026-11-03");
});

test("quick add: rawText is parsed, never stored", async () => {
  const raw = "Pembayaran berhasil! Kamu bayar Rp25.000 di Kopi Kenangan pakai GoPay. Ref 998877";
  const r = await quick({ accountId: bca, rawText: raw, capturedVia: "notification" });
  expect(r.transaction).toMatchObject({ amount: -2500000, merchant: "Kopi Kenangan", description: "Kopi Kenangan", capturedVia: "notification" });
  const [row] = await db.select().from(schema.transaction).where(eq(schema.transaction.id, r.transaction.id));
  expect(JSON.stringify(row)).not.toContain("998877");
});

test("quick add: most used account by default, clear error without accounts", async () => {
  const gopay = await testAccount(db, p, "GoPay");
  await importRows(gopay, [{ date: "2026-11-01", amount: -100, description: "A" }, { date: "2026-11-02", amount: -100, description: "B" }], true);
  const r = await quick({ amountText: "5rb", description: "Parkir" });
  expect(r.transaction.accountId).toBe(gopay);

  const other = await testPrincipal(db, "Sari");
  await expect(quickAdd(db, other, quickAddInput.parse({ amountText: "5rb", description: "Parkir" }))).rejects.toThrow(/No account yet/);
});

test("quick add: the same clientRef is added once, per household", async () => {
  const input = { accountId: bca, amountText: "25rb", description: "Kopi", clientRef: "phone-123" };
  const a = await quick(input);
  const b = await quick({ ...input, amountText: "30rb" });
  expect(a.created).toBe(true);
  expect(b.created).toBe(false);
  expect(b.transaction.id).toBe(a.transaction.id);
  expect(b.transaction.amount).toBe(-2500000);
  const rows = await db.select().from(schema.transaction).where(eq(schema.transaction.householdId, p.householdId));
  expect(rows.length).toBe(1);
  // Another household may use the same ref.
  const other = await testPrincipal(db, "Sari");
  const otherAccount = await testAccount(db, other);
  const c = await quickAdd(db, other, quickAddInput.parse({ ...input, accountId: otherAccount }));
  expect(c.created).toBe(true);
});

test("statement import: preview counts, commit replaces the pending row and keeps what the person added", async () => {
  const pend = await quick({ accountId: bca, amountText: "25rb", description: "Kopi sama Andi", merchant: "Kopi Kenangan", category: "food", note: "with Andi", occurredAt: "2026-11-02", clientRef: "c1" });
  const tagId = crypto.randomUUID();
  await db.insert(schema.tag).values({ id: tagId, householdId: p.householdId, name: "work" });
  await db.insert(schema.transactionTag).values({ transactionId: pend.transaction.id, tagId });
  await quick({ accountId: bca, amountText: "99rb", description: "Never on the statement", occurredAt: "2026-11-04" });
  await quick({ accountId: bca, amountText: "12rb", description: "Outside the period", occurredAt: "2026-10-20" });

  const rows: ImportRow[] = [
    { date: "2026-11-03", amount: -2500000, description: "QRIS KOPI KENANGAN SENOPATI", balanceAfter: 97500000 },
    { date: "2026-11-05", amount: -1000000, description: "PARKIR" },
  ];
  const preview = await importRows(bca, rows, false);
  expect(preview).toMatchObject({ newRows: 2, reconciled: 1, unmatchedPending: 1, inserted: 0 });
  expect(preview.preview[0]!.reconciles?.id).toBe(pend.transaction.id);
  expect((await searchTransactions(db, p, { status: "pending", limit: 50 })).transactions.length).toBe(3);

  const done = await importRows(bca, rows, true);
  expect(done).toMatchObject({ inserted: 2, reconciled: 1, unmatchedPending: 1 });
  const all = (await searchTransactions(db, p, { limit: 50 })).transactions;
  expect(all.length).toBe(4);
  const posted = all.find((x) => x.date === "2026-11-03")!;
  expect(posted).toMatchObject({
    status: "posted",
    amount: -2500000,
    description: "QRIS KOPI KENANGAN SENOPATI",
    merchant: "Kopi Kenangan",
    category: "food",
    categorySource: "manual",
    note: "with Andi",
    capturedVia: "manual",
  });
  expect(all.some((x) => x.id === pend.transaction.id)).toBe(false);
  const [row] = await db.select().from(schema.transaction).where(eq(schema.transaction.id, posted.id));
  expect(row).toMatchObject({ balanceAfter: 97500000, clientRef: "c1" });
  const tags = await db.select().from(schema.transactionTag).where(eq(schema.transactionTag.transactionId, posted.id));
  expect(tags.length).toBe(1);
  // A phone retrying the confirmed capture gets the posted row, not a new pending one.
  expect((await quick({ accountId: bca, amountText: "25rb", description: "Kopi", clientRef: "c1" })).created).toBe(false);

  // Re-importing adds nothing and matches nothing.
  const again = await importRows(bca, rows, true);
  expect(again).toMatchObject({ inserted: 0, reconciled: 0, duplicates: 2 });

  // Undo puts the confirmed capture back to pending instead of losing it.
  const undone = await undoImport(db, p, done.batchId!);
  expect(undone).toMatchObject({ removed: 1, restoredToPending: 1 });
  expect((await searchTransactions(db, p, { status: "pending", limit: 50 })).transactions.length).toBe(3);
});

test("statement import: no match across accounts", async () => {
  const jago = await testAccount(db, p, "Jago");
  await quick({ accountId: jago, amountText: "25rb", description: "Kopi", occurredAt: "2026-11-03" });
  const res = await importRows(bca, [{ date: "2026-11-03", amount: -2500000, description: "KOPI" }], true);
  expect(res).toMatchObject({ reconciled: 0, unmatchedPending: 0, inserted: 1 });
  expect((await searchTransactions(db, p, { status: "pending", limit: 50 })).transactions.length).toBe(1);
});

test("statement import: the statement's rule category wins; an import suggestion does not", async () => {
  await quick({ accountId: bca, amountText: "50rb", description: "Groceries", category: "food/groceries", occurredAt: "2026-11-03" });
  const res = await importRows(bca, [{ date: "2026-11-04", amount: -5000000, description: "INDOMARET", category: "shopping" }], true);
  expect(res.reconciled).toBe(1);
  const [row] = (await searchTransactions(db, p, { limit: 5 })).transactions;
  expect(row).toMatchObject({ category: "food/groceries", status: "posted" });
});

test("statement import: big imports stay within D1's parameter limit", async () => {
  for (let i = 0; i < 12; i++) await quick({ accountId: bca, amount: -(1000 + i) * 100, description: `Item ${i}`, occurredAt: "2026-10-10" });
  const rows: ImportRow[] = Array.from({ length: 300 }, (_, i) => ({ date: "2026-10-10", amount: -(1000 + i) * 100, description: `ROW ${i}` }));
  const res = await importRows(bca, rows, true);
  expect(res).toMatchObject({ inserted: 300, reconciled: 12, unmatchedPending: 0 });
});

test("pending rows: editable, deletable, counted in the dashboard", async () => {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const r = await quick({ accountId: bca, amountText: "25rb", description: "Kopi" });
  const fixed = await updateTransaction(db, p, { id: r.transaction.id, amount: -3000000, description: "Kopi besar" });
  expect(fixed).toMatchObject({ amount: -3000000, description: "Kopi besar", status: "pending" });
  const old = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
  await quick({ accountId: bca, amountText: "10rb", description: "Old", occurredAt: old });
  const d = await dashboard(db, p, { month: today.slice(0, 7) });
  expect(d.attention).toMatchObject({ pending: 2, pendingStale: 1 });
  expect(d.kpis.spending.amount).toBeGreaterThanOrEqual(3000000);

  const posted = await importRows(bca, [{ date: "2026-01-02", amount: -1, description: "X" }], true);
  const [stmtRow] = (await searchTransactions(db, p, { status: "posted", limit: 5 })).transactions;
  expect(posted.inserted).toBe(1);
  await expect(updateTransaction(db, p, { id: stmtRow!.id, amount: -2 })).rejects.toThrow(/cannot be edited/);
});

test("statement import: two concurrent commits of the same statement save each row once", async () => {
  const pend = await quick({ accountId: bca, amountText: "25rb", description: "Kopi", occurredAt: "2026-11-02", clientRef: "c-race" });
  const rows: ImportRow[] = [
    { date: "2026-11-01", amount: -1000000, description: "INDOMARET" },
    { date: "2026-11-02", amount: -2500000, description: "QRIS KOPI KENANGAN" },
  ];
  // Hold the first write until the second import has read too, so both see the same pending row and no saved rows.
  const batch = db.batch.bind(db);
  let waiting: (() => void) | null = null;
  let calls = 0;
  (db as { batch: unknown }).batch = async (stmts: Parameters<typeof batch>[0]) => {
    calls++;
    if (calls === 1) await new Promise<void>((resolve) => (waiting = resolve));
    else if (calls === 2) waiting!();
    return batch(stmts);
  };
  const [a, b] = await Promise.all([importRows(bca, rows, true), importRows(bca, rows, true)]);
  (db as { batch: unknown }).batch = batch;
  expect(a.inserted + b.inserted).toBe(2);
  expect(a.reconciled + b.reconciled).toBe(1);
  const all = await db.select().from(schema.transaction).where(eq(schema.transaction.accountId, bca));
  expect(all.map((r) => r.status).sort()).toEqual(["posted", "posted"]);
  expect(all.find((r) => r.amount === -2500000)!.clientRef).toBe("c-race");
  expect(all.some((r) => r.id === pend.transaction.id)).toBe(false);
  // The import log counts what each import actually saved; an import that saved nothing leaves no entry.
  const batches = await db.select().from(schema.importBatch).where(eq(schema.importBatch.accountId, bca));
  expect(batches.reduce((s, x) => s + x.insertedCount, 0)).toBe(2);
  for (const x of batches) expect(x.insertedCount + x.duplicateCount).toBe(2);
});
