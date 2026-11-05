import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Context, Principal } from "../context";
import { appRouter } from "../routers/index";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { deleteHousehold } from "./account";
import { listAccounts } from "./accounts";
import { memoryFileStore, sweepOrphanAttachments } from "./attachments";
import { dashboard } from "./dashboard";
import { importTransactions } from "./imports";
import { baseline } from "./plan";
import { budgetStatus, cashflow, setBudget, spendingSummary } from "./reports";
import { quickAdd, quickAddInput } from "./transactions";
import { PDFDocument } from "pdf-lib";

/** A real 1×1 JPEG. */
const JPEG = Uint8Array.from(
  atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="),
  (c) => c.charCodeAt(0),
);

let db: Database;
let p: Principal;
let other: Principal;
let bca: string;
let files: ReturnType<typeof memoryFileStore>;

beforeEach(async () => {
  ({ db } = await testDb());
  p = await testPrincipal(db);
  other = await testPrincipal(db, "Stranger");
  bca = await testAccount(db, p, "BCA");
  files = memoryFileStore();
});

const ctx = (principal = p): Context => ({ db, principal, files });
const r = appRouter.reimburse;
/** Last month (WIB): every day of it is in the past, and it is inside the plan baseline's window. */
const month = (() => {
  const now = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
})();
const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

async function add(amount: number, d: number, merchant: string, category = "food/dining") {
  return (await quickAdd(db, p, quickAddInput.parse({ accountId: bca, amount, description: merchant, merchant, category, occurredAt: day(d) }))).transaction.id;
}

async function profile(company = "PT Maju Jaya") {
  return call(r.profiles.create, { companyName: company, employeeId: "E-12", approverName: "Budi", approverEmail: "budi@maju.example" }, { context: ctx() });
}

async function upload(transactionId?: string) {
  const file = new File([JPEG], "struk.jpg", { type: "image/jpeg" });
  return (await call(appRouter.attachments.upload, { file, transactionId, replace: false }, { context: ctx() })).attachment;
}

describe("reimbursable expenses are not household spending", () => {
  test("dashboard, summary, cashflow, budgets and plan leave them out until rejected", async () => {
    const prof = await profile();
    await add(-10_000_000, 1, "Warung");
    const work = await add(-40_000_000, 2, "Hotel Bandung", "travel");
    const lunch = await add(-6_000_000, 2, "Bakmi GM");
    await setBudget(db, p, { category: "food", amount: 10_000_000 });

    const before = await dashboard(db, p, { month });
    expect(before.kpis.spending.amount).toBe(56_000_000);

    await call(r.mark, { ids: [work, lunch], reimbursable: true, profileId: prof.id }, { context: ctx() });
    const after = await dashboard(db, p, { month });
    expect(after.kpis.spending.amount).toBe(10_000_000);
    expect(after.categories.map((c) => c.slug)).toEqual(["food"]);
    expect(after.attention.reimburse).toMatchObject({ draft: 2, submitted: 0, owed: { amount: 46_000_000 } });
    expect((await spendingSummary(db, p, { from: day(1), to: day(28), groupBy: "category", kind: "expense", limit: 25 })).total[0]!.amount).toBe(10_000_000);
    expect((await cashflow(db, p, { fromMonth: month, toMonth: month })).months[0]!.expense.amount).toBe(10_000_000);
    expect((await budgetStatus(db, p, { month })).budgets[0]!.spent.amount).toBe(10_000_000);

    // The receivable account holds what the employer owes; the paying account is unchanged.
    const accounts = (await listAccounts(db, p)).accounts;
    expect(accounts.find((a) => a.id === prof.accountId)).toMatchObject({ type: "receivable", balance: { amount: 46_000_000 } });
    expect(accounts.find((a) => a.id === bca)!.balance.amount).toBe(-56_000_000);

    // Rejected: own spending again, and no longer owed.
    const { claim } = await call(r.claims.create, { profileId: prof.id }, { context: ctx() });
    await call(r.claims.setStatus, { id: claim.id, status: "paid", rejectIds: [lunch] }, { context: ctx() });
    const settled = await dashboard(db, p, { month });
    expect(settled.kpis.spending.amount).toBe(16_000_000);
    expect(settled.attention.reimburse.owed.amount).toBe(0);
    expect((await listAccounts(db, p)).accounts.find((a) => a.id === prof.accountId)!.balance.amount).toBe(0);
  });

  test("plan baseline ignores them", async () => {
    const prof = await profile();
    const id = await add(-50_000_000, 3, "Tiket pesawat", "travel");
    await add(-3_000_000, 4, "Warung");
    const before = await baseline(db, p, { months: 3 });
    await call(r.mark, { ids: [id], profileId: prof.id, reimbursable: true }, { context: ctx() });
    const after = await baseline(db, p, { months: 3 });
    const last = (b: typeof after) => b.spending.byMonth.find((m) => m.month === month)!.total.amount;
    expect(last(after)).toBe(3_000_000);
    expect(last(before)).toBe(53_000_000);
  });

  test("the employer's payment is a transfer, not income", async () => {
    const prof = await profile();
    const hotel = await add(-40_000_000, 2, "Hotel");
    const pay = await add(40_000_000, 9, "PT Maju Jaya", "income/other");
    await call(r.mark, { ids: [hotel], profileId: prof.id, reimbursable: true }, { context: ctx() });
    const { claim } = await call(r.claims.create, { profileId: prof.id, notes: "Kunjungan klien" }, { context: ctx() });
    expect(claim).toMatchObject({ number: `RB-${month.slice(0, 4)}-0001`, itemCount: 1, status: "submitted", total: { amount: 40_000_000 } });
    expect((await dashboard(db, p, { month })).kpis.income.amount).toBe(40_000_000);
    const res = await call(r.claims.setStatus, { id: claim.id, status: "paid", paymentTransactionId: pay }, { context: ctx() });
    expect(res.claim.status).toBe("paid");
    expect(res.payments.map((x) => x.id)).toEqual([pay]);
    expect(res.difference.amount).toBe(0);
    expect((await dashboard(db, p, { month })).kpis.income.amount).toBe(0);
    // Undo: the payment is income again and the items wait for the employer.
    const undone = await call(r.claims.setStatus, { id: claim.id, status: "submitted" }, { context: ctx() });
    expect(undone.items.map((i) => i.reimburse?.status)).toEqual(["submitted"]);
    expect((await dashboard(db, p, { month })).kpis.income.amount).toBe(40_000_000);
  });
});

describe("claims", () => {
  test("generate: PDF with the receipts, CSV, numbering, items submitted, then withdraw", async () => {
    const prof = await profile();
    const a = await add(-12_500_000, 4, "Grab");
    const b = await add(-8_750_000, 5, "Bakmi GM 🍜");
    await upload(a);
    await call(r.mark, { ids: [a, b], profileId: prof.id, reimbursable: true }, { context: ctx() });
    const { claim } = await call(r.claims.create, { profileId: prof.id, transactionIds: [a, b] }, { context: ctx() });
    expect(claim.total.amount).toBe(21_250_000);

    const pdf = await call(r.claims.pdf, { id: claim.id }, { context: ctx() });
    expect(pdf.type).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    // Report page + one receipt page + the "without a receipt" list.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);

    const csv = await (await call(r.claims.csv, { id: claim.id }, { context: ctx() })).text();
    expect(csv).toContain(claim.number);
    expect(csv).toContain("Dua ratus dua belas ribu lima ratus rupiah");

    // Submitted items cannot be claimed or unmarked again.
    await expect(call(r.claims.create, { profileId: prof.id, transactionIds: [a] }, { context: ctx() })).rejects.toThrow(/draft/);
    await expect(call(r.mark, { ids: [a], reimbursable: false }, { context: ctx() })).rejects.toThrow(/claim/);
    const second = await add(-1_000_000, 6, "Parkir");
    await call(r.mark, { ids: [second], profileId: prof.id, reimbursable: true }, { context: ctx() });
    expect((await call(r.claims.create, { profileId: prof.id }, { context: ctx() })).claim.number).toBe(`RB-${month.slice(0, 4)}-0002`);

    await call(r.claims.delete, { id: claim.id }, { context: ctx() });
    const items = await call(r.items, { profileId: prof.id, status: "draft" }, { context: ctx() });
    expect(items.items.map((i) => i.id).sort()).toEqual([a, b].sort());

    // Nobody else can read it.
    const list = await call(r.claims.list, {}, { context: ctx(other) });
    expect(list.claims).toEqual([]);
  });

  test("only money out, own transactions, an existing profile", async () => {
    const prof = await profile();
    const income = await add(5_000_000, 1, "Refund");
    await expect(call(r.mark, { ids: [income], profileId: prof.id, reimbursable: true }, { context: ctx() })).rejects.toThrow(/money out/);
    const mine = await add(-5_000_000, 1, "Taksi");
    await expect(call(r.mark, { ids: [mine], reimbursable: true }, { context: ctx(other) })).rejects.toThrow(/not found/);
    // Default profile: the one used last.
    const res = await call(r.mark, { ids: [mine], reimbursable: true }, { context: ctx() });
    expect(res.profileId).toBe(prof.id);
  });

  test("profiles: delete unused, archive used", async () => {
    const unused = await profile("PT Lama");
    expect(await call(r.profiles.delete, { id: unused.id }, { context: ctx() })).toEqual({ deleted: unused.id, archived: false });
    expect((await listAccounts(db, p, { includeArchived: true })).accounts.some((a) => a.id === unused.accountId)).toBe(false);
    const used = await profile();
    const id = await add(-5_000_000, 1, "Taksi");
    await call(r.mark, { ids: [id], reimbursable: true, profileId: used.id }, { context: ctx() });
    await expect(call(r.profiles.delete, { id: used.id }, { context: ctx() })).rejects.toThrow(/open items/);
    const { claim } = await call(r.claims.create, { profileId: used.id }, { context: ctx() });
    await call(r.claims.setStatus, { id: claim.id, status: "paid" }, { context: ctx() });
    expect((await call(r.profiles.delete, { id: used.id }, { context: ctx() })).archived).toBe(true);
    // Its report can still be downloaded.
    expect((await call(r.claims.pdf, { id: claim.id }, { context: ctx() })).type).toBe("application/pdf");
  });
});

describe("receipt photos", () => {
  test("quick add keeps an uploaded photo and marks it reimbursable; served only to the household", async () => {
    const prof = await profile();
    const photo = await upload();
    const res = await call(
      appRouter.transactions.quickAdd,
      { accountId: bca, amount: -7_500_000, description: "Bensin", attachmentIds: [photo.id], reimbursable: true, capturedVia: "receipt" },
      { context: ctx() },
    );
    expect(res.transaction.attachments.map((x) => x.id)).toEqual([photo.id]);
    expect(res.transaction.reimburse).toEqual({ status: "draft", profileId: prof.id, claimId: null });
    const file = await call(appRouter.attachments.get, { id: photo.id }, { context: ctx() });
    expect(file.type).toBe("image/jpeg");
    await expect(call(appRouter.attachments.get, { id: photo.id }, { context: ctx(other) })).rejects.toThrow(/not found/);
    await expect(call(appRouter.attachments.upload, { file: new File(["hello"], "x.jpg"), replace: false }, { context: ctx() })).rejects.toThrow(/JPEG or PNG/);
  });

  test("deleting the transaction, undoing its import or deleting the household removes the files", async () => {
    const id = await add(-1_000_000, 1, "Kopi");
    await upload(id);
    expect(files.objects.size).toBe(1);
    await call(appRouter.transactions.delete, { id }, { context: ctx() });
    expect(files.objects.size).toBe(0);

    const imported = await importTransactions(db, p, { accountId: bca, rows: [{ date: day(2), amount: -2_000_000, description: "TOKO" }], commit: true, source: "api", previewLimit: 5 });
    const [row] = await db.select().from(schema.transaction).where(eq(schema.transaction.importBatchId, imported.batchId!));
    await upload(row!.id);
    await call(appRouter.imports.undo, { id: imported.batchId! }, { context: ctx() });
    expect(files.objects.size).toBe(0);

    await upload(await add(-1_000_000, 3, "Kopi"));
    await upload();
    expect(files.objects.size).toBe(2);
    const [h] = await db.select().from(schema.household).where(eq(schema.household.id, p.householdId));
    await deleteHousehold(db, p, { confirmName: h!.name }, files);
    expect(files.objects.size).toBe(0);
  });

  test("a statement row that confirms a quick add takes its photo and reimbursement", async () => {
    const prof = await profile();
    const photo = await upload();
    const q = await call(
      appRouter.transactions.quickAdd,
      { accountId: bca, amount: -3_000_000, description: "Taksi", attachmentIds: [photo.id], reimbursable: true, reimburseProfileId: prof.id, occurredAt: day(4) },
      { context: ctx() },
    );
    const res = await importTransactions(db, p, { accountId: bca, rows: [{ date: day(4), amount: -3_000_000, description: "BLUEBIRD 123" }], commit: true, source: "api", previewLimit: 5 });
    expect(res.reconciled).toBe(1);
    const [row] = await db.select().from(schema.transaction).where(eq(schema.transaction.importBatchId, res.batchId!));
    expect(row!.id).not.toBe(q.transaction.id);
    expect(row).toMatchObject({ reimburseStatus: "draft", reimburseProfileId: prof.id });
    const [att] = await db.select().from(schema.attachment).where(eq(schema.attachment.id, photo.id));
    expect(att!.transactionId).toBe(row!.id);
    expect(files.objects.size).toBe(1);
  });

  test("uploads never saved are swept after a day", async () => {
    await upload();
    expect(await sweepOrphanAttachments(db, files)).toBe(0);
    expect(await sweepOrphanAttachments(db, files, Date.now() + 25 * 3_600_000)).toBe(1);
    expect(files.objects.size).toBe(0);
  });

  test("receipt capture without AI keeps the photo and returns an empty draft", async () => {
    const res = await call(appRouter.capture.receipt, { image: new File([JPEG], "s.jpg", { type: "image/jpeg" }) }, { context: ctx() });
    expect(res.ocr.status).toBe("off");
    expect(res.draft.amount).toBeNull();
    expect(res.attachment).toMatchObject({ mime: "image/jpeg", width: 1, height: 1, transactionId: null });
  });
});
