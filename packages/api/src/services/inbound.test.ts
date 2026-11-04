import { beforeEach, describe, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { and, count, eq, isNotNull } from "drizzle-orm";

import type { Principal } from "../context";
import { mailbox, senderAuth } from "../lib/mime";
import { sampleGopayText, sampleJagoText } from "../lib/statements/sample";
import { testDb, testPrincipal } from "../test/d1";
import { cfAuth, longJagoText, rawEmail } from "../test/email";
import { makePdf } from "../test/pdf";
import { disableEmailImport, emailImportStatus, receiveEmail, regenerateEmailImport, tokenFromRecipient } from "./inbound";

const DOMAIN = "by.dzulfikar.com";
const config = { domain: DOMAIN, appUrl: "https://baroka.by.dzulfikar.com" };

let db: Database;
let owner: Principal;
let ownerEmail: string;
let address: string;

beforeEach(async () => {
  ({ db } = await testDb());
  owner = await testPrincipal(db, "Rina");
  ownerEmail = "rina.pratama@gmail.com";
  await db.update(schema.user).set({ email: ownerEmail }).where(eq(schema.user.id, owner.userId));
  address = (await regenerateEmailImport(db, owner, DOMAIN)).address!;
});

const jagoPdf = () => makePdf(sampleJagoText());
const gopayPdf = () => makePdf(sampleGopayText());

function send(from: string, attachments: { name: string; content: Uint8Array; type?: string }[] = [], extra: { to?: string; auth?: boolean | null; subject?: string; text?: string; headers?: string[] } = {}) {
  const auth = extra.auth === undefined ? true : extra.auth;
  const raw = rawEmail({
    from,
    to: extra.to ?? address,
    subject: extra.subject,
    text: extra.text,
    attachments,
    headers: [...(auth === null ? [] : [cfAuth(from, auth)]), ...(extra.headers ?? [])],
  });
  return receiveEmail(db, { from, to: extra.to ?? address, raw }, config);
}

async function txCount(householdId: string) {
  const [r] = await db.select({ n: count() }).from(schema.transaction).where(eq(schema.transaction.householdId, householdId));
  return r!.n;
}

async function log(householdId = owner.householdId) {
  return db.select().from(schema.inboundEmail).where(eq(schema.inboundEmail.householdId, householdId));
}

describe("addresses", () => {
  test("import+<token>@domain; regenerate replaces it, disable turns it off", async () => {
    expect(address).toMatch(/^import\+[a-z2-7]{26}@by\.dzulfikar\.com$/);
    const token = tokenFromRecipient(address.toUpperCase(), DOMAIN);
    expect(token).toBe(address.slice(7, 33));
    expect(tokenFromRecipient(address, "other.com")).toBeNull();
    expect(tokenFromRecipient(`import@${DOMAIN}`, DOMAIN)).toBeNull();

    const next = (await regenerateEmailImport(db, owner, DOMAIN)).address!;
    expect(next).not.toBe(address);
    expect(await send(ownerEmail, [{ name: "a.pdf", content: jagoPdf() }])).toEqual({ action: "reject", reason: "Unknown address" });

    const off = await disableEmailImport(db, owner, DOMAIN);
    expect(off.enabled).toBe(false);
    expect(await send(ownerEmail, [{ name: "a.pdf", content: jagoPdf() }], { to: next })).toMatchObject({ action: "reject" });
    expect(await txCount(owner.householdId)).toBe(0);
    // Not configured on the server: nothing is accepted and the address cannot be turned on.
    expect((await emailImportStatus(db, owner, null)).available).toBe(false);
    expect(regenerateEmailImport(db, owner, null)).rejects.toThrow("not configured");
  });
});

describe("receiving", () => {
  test("a member's statement is imported with commit=true and summarised in the reply", async () => {
    // Gmail's auto-forward sends from you+caf_=...@gmail.com; dots do not matter to Gmail either.
    const res = await send("rinapratama+caf_=import=by.dzulfikar.com@gmail.com", [{ name: "jago-oct.pdf", content: jagoPdf() }]);
    expect(res.action).toBe("reply");
    if (res.action !== "reply") return;
    expect(res.status).toBe("imported");
    expect(res.text).toContain("✓ jago-oct.pdf: Bank Jago statement, 1 Oct 2026 – ");
    expect(res.text).toContain("Every running balance checked.");
    expect(res.text).toMatch(/\d+ new, 0 already imported/);
    expect(await txCount(owner.householdId)).toBeGreaterThan(5);
    const batches = await db.select().from(schema.importBatch).where(eq(schema.importBatch.householdId, owner.householdId));
    expect(batches.every((b) => b.source === "email" && b.createdBy === owner.userId && b.fileName === "jago-oct.pdf")).toBe(true);
    const [row] = await log();
    expect(row).toMatchObject({ status: "imported", userId: owner.userId });

    // The same email again adds nothing.
    const again = await send(ownerEmail, [{ name: "jago-oct.pdf", content: jagoPdf() }]);
    expect(again.action === "reply" && again.text).toMatch(/ 0 new, \d+ already imported/);
  });

  test("two PDFs: Jago and GoPay, the GoPay one names the Jago payments", async () => {
    const res = await send(ownerEmail, [
      { name: "jago.pdf", content: jagoPdf() },
      { name: "gopay.pdf", content: gopayPdf(), type: "application/octet-stream" },
    ]);
    expect(res).toMatchObject({ action: "reply", status: "imported" });
    if (res.action !== "reply") return;
    expect(res.text).toContain("✓ jago.pdf: Bank Jago statement");
    expect(res.text).toMatch(/✓ gopay\.pdf: GoPay e-statement, .*\n {2}[1-9]\d* Jago payments named/);
    const viaGopay = await db
      .select({ merchant: schema.transaction.merchant })
      .from(schema.transaction)
      .where(and(eq(schema.transaction.householdId, owner.householdId), isNotNull(schema.transaction.paymentRef)));
    expect(viaGopay.length).toBeGreaterThan(3);
    expect(viaGopay.filter((r) => r.merchant === "GoPay")).toEqual([]);
    const [row] = await log();
    expect((row!.detail as { files: unknown[] }).files.length).toBe(2);
  });

  test("a sender who is not a member: nothing imported, no reply, logged", async () => {
    const res = await send("someone@else.com", [{ name: "jago.pdf", content: jagoPdf() }]);
    expect(res).toEqual({ action: "drop", status: "rejected_sender" });
    expect(await txCount(owner.householdId)).toBe(0);
    expect((await log())[0]).toMatchObject({ status: "rejected_sender", fromAddress: "someone@else.com", userId: null });
  });

  test("a member's address that failed SPF/DKIM/DMARC is refused (spoofed sender)", async () => {
    const res = await send(ownerEmail, [{ name: "jago.pdf", content: jagoPdf() }], { auth: false });
    expect(res).toEqual({ action: "drop", status: "rejected_sender" });
    expect(await txCount(owner.householdId)).toBe(0);
  });

  test("a member of another household cannot import into this one", async () => {
    const other = await testPrincipal(db, "Budi");
    await db.update(schema.user).set({ email: "budi@example.com" }).where(eq(schema.user.id, other.userId));
    expect(await send("budi@example.com", [{ name: "jago.pdf", content: jagoPdf() }])).toMatchObject({ action: "drop" });
    expect(await txCount(owner.householdId)).toBe(0);
    expect(await txCount(other.householdId)).toBe(0);
  });

  test("no PDF attached: reply saying so", async () => {
    const res = await send(ownerEmail, [{ name: "photo.jpg", type: "image/jpeg", content: new Uint8Array([1, 2, 3]) }]);
    expect(res).toMatchObject({ action: "reply", status: "no_pdf" });
    expect(res.action === "reply" && res.text).toContain("No PDF attached");
  });

  test("password-protected PDF: reply asking to upload it in the app", async () => {
    const res = await send(ownerEmail, [{ name: "bca.pdf", content: makePdf("BCA", { encrypted: true }) }]);
    expect(res).toMatchObject({ action: "reply", status: "failed" });
    expect(res.action === "reply" && res.text).toContain("✗ bca.pdf\n  Password-protected PDF.");
  });

  test("a PDF that is not a statement JoyoArto reads, next to one it does: partial", async () => {
    const res = await send(ownerEmail, [
      { name: "jago.pdf", content: jagoPdf() },
      { name: "invoice.pdf", content: makePdf("INVOICE 123\nTotal Rp 50.000") },
    ]);
    expect(res).toMatchObject({ action: "reply", status: "partial" });
    expect(res.action === "reply" && res.text).toContain("✗ invoice.pdf\n  Not a statement JoyoArto can read yet");
  });

  test("automatic mail (Auto-Submitted) is processed but never answered", async () => {
    const res = await send(ownerEmail, [], { headers: ["Auto-Submitted: auto-replied"] });
    expect(res).toEqual({ action: "drop", status: "no_pdf" });
  });

  test("Gmail's forwarding confirmation code is kept for Settings", async () => {
    const res = await send("forwarding-noreply@google.com", [], {
      subject: "(#987654321) Gmail Forwarding Confirmation - Receive Mail from rina.pratama@gmail.com",
      text: "Confirmation code: 987654321",
    });
    expect(res).toEqual({ action: "drop", status: "forwarding_confirmation" });
    const status = await emailImportStatus(db, owner, DOMAIN);
    expect(status.recent[0]).toMatchObject({ status: "forwarding_confirmation", detail: { code: "987654321" } });
  });

  test("a long statement stays within D1's 100 bound parameters (the test D1 enforces it)", async () => {
    const res = await send(ownerEmail, [{ name: "long.pdf", content: makePdf(longJagoText(260)) }]);
    expect(res).toMatchObject({ action: "reply", status: "imported" });
    expect(await txCount(owner.householdId)).toBe(260);
  });

  test("the inbound log keeps the newest 100 rows per household", async () => {
    for (let i = 0; i < 103; i++) await send("x@else.com");
    expect((await log()).length).toBe(100);
  });
});

describe("mime helpers", () => {
  test("mailbox: case, +tags and Gmail dots", () => {
    expect(mailbox("<Rina.Pratama+caf_=x=y.com@GMAIL.com>")).toBe("rinapratama@gmail.com");
    expect(mailbox("a.b+news@example.com")).toBe("a.b@example.com");
    expect(mailbox("x@googlemail.com")).toBe("x@gmail.com");
  });

  test("senderAuth reads Cloudflare's results only", () => {
    const h = (value: string, key = "arc-authentication-results") => [{ key, value }];
    expect(senderAuth([], "a@b.com")).toBe("unknown");
    expect(senderAuth(h("i=1; mx.google.com; dmarc=pass"), "a@b.com")).toBe("unknown");
    expect(senderAuth(h(cfAuth("a@b.com").split(": ").slice(1).join(": ")), "a@b.com")).toBe("pass");
    expect(senderAuth(h(cfAuth("a@b.com", false).split(": ").slice(1).join(": ")), "a@b.com")).toBe("fail");
    expect(senderAuth(h("mx.cloudflare.net; dkim=pass header.d=evil.com; spf=pass smtp.mailfrom=x@evil.com; dmarc=fail"), "a@b.com")).toBe("fail");
    expect(senderAuth(h("mx.cloudflare.net; spf=pass smtp.mailfrom=bounce@mail.b.com", "authentication-results"), "a@mail.b.com")).toBe("pass");
  });
});
