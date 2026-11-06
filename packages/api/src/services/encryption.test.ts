// Field-level encryption (DATA_KEY) through the real services: what the database holds is ciphertext, what every
// reader (oRPC/REST, MCP and Joyo AI call the same procedures) gets is plaintext, the member's export is plaintext,
// and the backfill seals old rows without answering with any data.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database as Sqlite } from "bun:sqlite";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Context, Principal } from "../context";
import { configureDataKey, DataKeyError } from "../lib/data-key";
import { ENC_PREFIX, isEncryptedBytes } from "../lib/field-crypto";
import { appRouter } from "../routers/index";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { cfAuth, rawEmail } from "../test/email";
import { exportCsvFile, exportJsonFile } from "./account";
import { memoryFileStore } from "./attachments";
import { ENCRYPTED_COLUMNS, backfill, columnName } from "./encryption";
import { receiveEmail, regenerateEmailImport, emailImportStatus } from "./inbound";
import { importInput, importTransactions, listImports } from "./imports";
import { appendMessage, createConversation, getConversation, historyOf, listConversations, saveProposals } from "./joyo";

/** Throwaway test keys, never used anywhere else. */
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7) % 256)));
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 256)));

const JPEG = Uint8Array.from(
  atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="),
  (c) => c.charCodeAt(0),
);

let db: Database;
let sqlite: Sqlite;
let p: Principal;
let bca: string;
let files: ReturnType<typeof memoryFileStore>;

beforeEach(async () => {
  ({ db, sqlite } = await testDb());
  p = await testPrincipal(db);
  bca = await testAccount(db, p);
  files = memoryFileStore();
});

afterEach(() => configureDataKey(null));

const ctx = (): Context => ({ db, principal: p, files });

/** The raw value as the D1 console would show it. */
function raw(table: string, column: string): string[] {
  return (sqlite.query(`select "${column}" as v from "${table}" where "${column}" is not null`).all() as { v: string }[]).map((r) => r.v);
}

/** Every finance-text value in the database, to check nothing readable is left. */
function rawDump(): string {
  return ENCRYPTED_COLUMNS.flatMap((x) => raw(columnName(x).split(".")[0]!, x.column.name)).join("\n");
}

async function seedEverything() {
  const tx = (
    await call(appRouter.transactions.add, { accountId: bca, date: "2026-10-03", amount: -12_500_000, description: "TRSF KE BUDI", note: "Utang ke Budi untuk berobat ibu" }, { context: ctx() })
  ).transaction;
  await call(appRouter.transactions.quickAdd, { amount: -2_500_000, description: "kopi", note: "Ngopi sama calon klien rahasia", accountId: bca }, { context: ctx() });
  const prof = await call(
    appRouter.reimburse.profiles.create,
    { companyName: "PT Maju Jaya", claimantName: "Dewi Lestari", employeeId: "NIK-778899", department: "Keuangan", approverName: "Pak Hartono", approverEmail: "hartono@maju.example", currency: "IDR" },
    { context: ctx() },
  );
  await call(appRouter.reimburse.mark, { ids: [tx.id], reimbursable: true, profileId: prof.id }, { context: ctx() });
  const claim = (await call(appRouter.reimburse.claims.create, { profileId: prof.id, notes: "Dinas ke Surabaya" }, { context: ctx() })).claim;
  const photo = (await call(appRouter.attachments.upload, { file: new File([JPEG], "struk.jpg", { type: "image/jpeg" }), transactionId: tx.id, replace: false }, { context: ctx() })).attachment;
  const conv = await createConversation(db, p, "Berapa gaji suamiku bulan lalu?");
  const answer = await appendMessage(db, conv, { role: "assistant", content: "Gaji masuk Rp 18 jt", steps: [{ id: "s1", tool: "search_transactions", title: "Search", args: { q: "gaji" }, ok: true }], proposals: [] });
  await saveProposals(db, answer.id, [{ id: "p1", tool: "quick_add", title: "Quick add", summary: "Tabungan anak Rp 1 jt", args: { amount: -100_000_000 }, status: "pending" }]);
  await call(appRouter.plan.scenarios.save, { name: "Mobil", plan: { monthlyIncome: 2_000_000_000, items: [{ type: "loan", label: "Mobil keluarga", price: 25_000_000_000, downPaymentPct: 30, tenorMonths: 48, ratePct: 5 }] }, view: { note: "rahasia" } }, { context: ctx() });
  await importTransactions(db, p, importInput.parse({ accountId: bca, rows: [{ date: "2026-10-04", amount: -1_000_000, description: "PARKIR" }], commit: true, source: "pdf", fileName: "e-Statement DEWI LESTARI Okt.pdf" }));
  return { tx, prof, claim, photo, conv };
}

const SECRETS = ["Utang ke Budi", "calon klien", "Dewi Lestari", "NIK-778899", "Keuangan", "Hartono", "hartono@maju", "Surabaya", "gaji suamiku", "Rp 18 jt", "Tabungan anak", "Mobil keluarga", "DEWI LESTARI", "rahasia"];

describe("with DATA_KEY set", () => {
  test("the database holds ciphertext; every reader gets plaintext", async () => {
    configureDataKey(KEY);
    const { tx, prof, claim, photo, conv } = await seedEverything();

    // What a D1 console, export or backup shows.
    const dump = rawDump();
    for (const s of SECRETS) expect(dump).not.toContain(s);
    expect(raw("transaction", "note").every((v) => v.startsWith(ENC_PREFIX))).toBe(true);
    expect(raw("joyo_message", "steps").every((v) => v.startsWith(`"${ENC_PREFIX}`))).toBe(true);
    const [object] = [...files.objects.entries()];
    expect(object![0].endsWith(".enc")).toBe(true);
    expect(isEncryptedBytes(object![1].body)).toBe(true);

    // What members (web, phone, REST, MCP, Joyo AI) get.
    const found = await call(appRouter.transactions.search, { q: "berobat" }, { context: ctx() });
    expect(found.transactions.map((t) => t.id)).toEqual([tx.id]);
    expect(found.transactions[0]!.note).toBe("Utang ke Budi untuk berobat ibu");
    expect((await call(appRouter.transactions.search, { q: "BUDI" }, { context: ctx() })).transactions).toHaveLength(1);
    expect((await call(appRouter.transactions.search, { q: "KLIEN" }, { context: ctx() })).transactions.map((t) => t.note)).toEqual(["Ngopi sama calon klien rahasia"]);
    expect((await call(appRouter.transactions.update, { id: tx.id, note: "Lunas" }, { context: ctx() })).note).toBe("Lunas");

    const profiles = (await call(appRouter.reimburse.profiles.list, {}, { context: ctx() })).profiles;
    expect(profiles[0]).toMatchObject({ id: prof.id, claimantName: "Dewi Lestari", employeeId: "NIK-778899", approverEmail: "hartono@maju.example" });
    expect((await call(appRouter.reimburse.claims.get, { id: claim.id }, { context: ctx() })).claim.notes).toBe("Dinas ke Surabaya");
    const csv = await (await call(appRouter.reimburse.claims.csv, { id: claim.id }, { context: ctx() })).text();
    expect(csv).toContain("Dewi Lestari");
    expect(csv).toContain("berobat ibu");
    const pdf = await call(appRouter.reimburse.claims.pdf, { id: claim.id }, { context: ctx() });
    expect(pdf.size).toBeGreaterThan(1000);

    const file = await call(appRouter.attachments.get, { id: photo.id }, { context: ctx() });
    expect(file.type).toBe("image/jpeg");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...JPEG]);

    expect((await listConversations(db, p)).conversations[0]!.title).toBe("Berapa gaji suamiku bulan lalu?");
    const full = await getConversation(db, p, conv);
    expect(full.messages[0]).toMatchObject({ content: "Gaji masuk Rp 18 jt", steps: [{ args: { q: "gaji" } }], proposals: [{ summary: "Tabungan anak Rp 1 jt" }] });
    expect((await historyOf(db, conv))[0]!.content).toBe("Gaji masuk Rp 18 jt");

    const scenario = (await call(appRouter.plan.scenarios.list, {}, { context: ctx() })).scenarios[0]!;
    expect(scenario.labels).toEqual(["Mobil keluarga"]);
    expect((await call(appRouter.plan.scenarios.get, { id: scenario.id }, { context: ctx() })).view).toEqual({ note: "rahasia" });
    expect((await call(appRouter.plan.simulate, { scenarioId: scenario.id }, { context: ctx() })).baseline.monthlyIncome.amount).toBe(2_000_000_000);

    expect((await listImports(db, p)).imports[0]!.fileName).toBe("e-Statement DEWI LESTARI Okt.pdf");
  });

  test("the inbound email log keeps subjects sealed", async () => {
    configureDataKey(KEY);
    const ownerEmail = "dewi@example.com";
    await db.update(schema.user).set({ email: ownerEmail }).where(eq(schema.user.id, p.userId));
    const domain = "arto.example";
    const address = (await regenerateEmailImport(db, p, domain)).address!;
    const rawMail = rawEmail({ from: ownerEmail, to: address, subject: "Tagihan kartu kredit Dewi", text: "hi", attachments: [], headers: [cfAuth(ownerEmail, true)] });
    await receiveEmail(db, { from: ownerEmail, to: address, raw: rawMail }, { domain, appUrl: "https://app.example" });
    expect(raw("inbound_email", "subject")[0]!.startsWith(ENC_PREFIX)).toBe(true);
    expect(raw("inbound_email", "detail")[0]!.startsWith(`"${ENC_PREFIX}`)).toBe(true);
    const status = await emailImportStatus(db, p, domain);
    expect(status.recent[0]).toMatchObject({ subject: "Tagihan kartu kredit Dewi", status: "no_pdf" });
    expect(status.recent[0]!.detail).toMatchObject({ attachments: 0 });
  });

  test("the member's export (JSON and CSV) is plaintext", async () => {
    configureDataKey(KEY);
    await seedEverything();
    const json = await (await exportJsonFile(db, p)).text();
    const data = JSON.parse(json);
    expect(json).not.toContain(ENC_PREFIX);
    expect(data.transactions.map((t: { note: string | null }) => t.note)).toContain("Utang ke Budi untuk berobat ibu");
    expect(data.reimbursementProfiles[0].employeeId).toBe("NIK-778899");
    expect(data.reimbursementClaims[0].snapshot.notes).toBe("Dinas ke Surabaya");
    expect(data.joyoConversations[0].title).toBe("Berapa gaji suamiku bulan lalu?");
    expect(data.joyoConversations[0].messages[0].proposals[0].summary).toBe("Tabungan anak Rp 1 jt");
    expect(data.planScenarios[0].plan.items[0].label).toBe("Mobil keluarga");
    expect(data.imports[0].fileName).toBe("e-Statement DEWI LESTARI Okt.pdf");
    const csv = await (await exportCsvFile(db, p)).text();
    expect(csv).toContain("Utang ke Budi untuk berobat ibu");
    expect(csv).not.toContain(ENC_PREFIX);
  });

  test("a different key cannot read the data (and says so, never shows ciphertext)", async () => {
    configureDataKey(KEY);
    await seedEverything();
    configureDataKey(OTHER_KEY);
    await expect(call(appRouter.transactions.search, {}, { context: ctx() })).rejects.toThrow(DataKeyError);
    configureDataKey(null);
    await expect(call(appRouter.reimburse.profiles.list, {}, { context: ctx() })).rejects.toThrow(/not configured/);
    // Rotation: the old key as DATA_KEY_PREVIOUS still reads.
    configureDataKey(OTHER_KEY, [KEY]);
    expect((await call(appRouter.reimburse.profiles.list, {}, { context: ctx() })).profiles[0]!.employeeId).toBe("NIK-778899");
  });
});

describe("without DATA_KEY", () => {
  test("values are stored as before", async () => {
    await seedEverything();
    expect(rawDump()).not.toContain(ENC_PREFIX);
    expect(raw("transaction", "note")).toContain("Utang ke Budi untuk berobat ibu");
    expect([...files.objects.keys()][0]!.endsWith(".enc")).toBe(false);
    expect((await call(appRouter.transactions.search, { q: "berobat" }, { context: ctx() })).transactions).toHaveLength(1);
  });

  test("the backfill refuses to run", async () => {
    await expect(backfill(db, files, { limit: 10, files: 1 })).rejects.toThrow(/DATA_KEY is not set/);
  });
});

describe("backfill", () => {
  test("seals old rows and photos in chunks, is safe to repeat, and answers with counts only", async () => {
    await seedEverything();
    // More notes than one call's limit, and more than D1's 100 parameters would allow in one statement.
    for (let i = 0; i < 130; i++) await call(appRouter.transactions.quickAdd, { amount: -100_000 - i, description: `t${i}`, note: `catatan pribadi ${i}`, accountId: bca }, { context: ctx() });
    configureDataKey(KEY);

    const first = await backfill(db, files, { limit: 100, files: 10 });
    expect(first.encrypted["transaction.note"]).toBe(100);
    expect(first.remaining["transaction.note"]).toBe(32);
    expect(first.encrypted["attachment.file"]).toBe(1);
    expect(first.done).toBe(false);
    const answer = JSON.stringify(first);
    for (const s of [...SECRETS, "catatan pribadi"]) expect(answer).not.toContain(s);

    const second = await backfill(db, files, { limit: 100, files: 10 });
    expect(second.done).toBe(true);
    expect(Object.values(second.remaining).every((n) => n === 0)).toBe(true);
    const third = await backfill(db, files, { limit: 100, files: 10 });
    expect(Object.values(third.encrypted).every((n) => n === 0)).toBe(true);

    const dump = rawDump();
    for (const s of [...SECRETS, "catatan pribadi"]) expect(dump).not.toContain(s);
    expect([...files.objects.keys()].every((k) => k.endsWith(".enc"))).toBe(true);
    expect([...files.objects.values()].every((o) => isEncryptedBytes(o.body))).toBe(true);

    // Everything still reads the same.
    expect((await call(appRouter.transactions.search, { q: "catatan pribadi 129" }, { context: ctx() })).transactions).toHaveLength(1);
    const photoId = raw("attachment", "id")[0]!;
    expect([...new Uint8Array(await (await call(appRouter.attachments.get, { id: photoId }, { context: ctx() })).arrayBuffer())]).toEqual([...JPEG]);
    const data = JSON.parse(await (await exportJsonFile(db, p)).text());
    expect(data.joyoConversations[0].messages[0].steps[0].args).toEqual({ q: "gaji" });
    expect(data.inboundEmails).toEqual([]);
  });

  test("a photo whose object is gone is marked and not picked again", async () => {
    const { photo } = await seedEverything();
    files.objects.clear();
    configureDataKey(KEY);
    const r = await backfill(db, files, { limit: 0, files: 5 });
    expect(r).toMatchObject({ missingFiles: 1, remaining: { "attachment.file": 0 } });
    await expect(call(appRouter.attachments.get, { id: photo.id }, { context: ctx() })).rejects.toThrow(/not found/);
  });

  test("operators only", async () => {
    configureDataKey(KEY);
    const request = { ip: null, adminEmails: ["boss@example.com"] };
    await expect(call(appRouter.admin.encryptionBackfill, {}, { context: { ...ctx(), request } })).rejects.toThrow(/operators/);
    const boss = { ...request, adminEmails: [`${p.userId}@example.com`] };
    expect((await call(appRouter.admin.encryptionBackfill, {}, { context: { ...ctx(), request: boss } })).done).toBe(true);
    await expect(call(appRouter.admin.encryptionBackfill, {}, { context: { ...ctx(), principal: { ...p, via: "token" }, request: boss } })).rejects.toThrow();
  });
});
