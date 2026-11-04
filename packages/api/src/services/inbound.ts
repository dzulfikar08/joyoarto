// Statements by email. Each household can turn on a private address, `import+<token>@<IMPORT_EMAIL_DOMAIN>`; Cloudflare
// Email Routing hands mail for it to the Worker's email() handler (apps/server/src/email.ts), which calls
// receiveEmail. Mail is read only when the envelope sender is a member of that household (and, when Cloudflare reports
// it, authenticated for its domain); its PDF attachments are imported like an upload with commit=true (dedupe makes
// a second copy harmless) and the sender gets a short summary back.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import type { InboundStatus } from "@baroka/db/schema/inbound";
import { and, desc, eq, notInArray } from "drizzle-orm";
import PostalMime from "postal-mime";
import type { Attachment, RawEmail } from "postal-mime";

import type { Principal } from "../context";
import { mailbox, senderAuth } from "../lib/mime";
import type { SenderAuth } from "../lib/mime";
import { MAX_PDF_BYTES, pdfText } from "../lib/pdf/extract";
import { importStatement } from "./statements";

const addr = schema.emailImportAddress;
const inbound = schema.inboundEmail;

export const IMPORT_LOCAL_PART = "import";
/** PDFs read from one email; more are listed as skipped. */
export const MAX_PDFS_PER_EMAIL = 10;
/** Inbound log rows kept per household (newest first). */
const KEEP_INBOUND = 100;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 26 lower-case base32 characters: 130 random bits, safe in an email local part, case-insensitive. */
export function newImportToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return Array.from(bytes, (b) => BASE32[b & 31]).join("");
}

export function importAddress(token: string, domain: string): string {
  return `${IMPORT_LOCAL_PART}+${token}@${domain}`;
}

/** The token in `import+<token>@<domain>`, or null for any other recipient. */
export function tokenFromRecipient(to: string, domain: string): string | null {
  const m = /^import\+([a-z2-7]{26})@(.+)$/.exec(to.trim().toLowerCase().replace(/^<|>$/g, ""));
  return m && m[2] === domain.toLowerCase() ? m[1]! : null;
}

// ------------------------------------------------------------------------------------------------ settings

function notConfigured(): never {
  throw new Error("Email import is not configured on this server (IMPORT_EMAIL_DOMAIN).");
}

export async function emailImportStatus(db: Database, p: Principal, domain: string | null) {
  const [row] = await db.select().from(addr).where(eq(addr.householdId, p.householdId));
  const recent = await db
    .select({ id: inbound.id, fromAddress: inbound.fromAddress, subject: inbound.subject, status: inbound.status, detail: inbound.detail, createdAt: inbound.createdAt })
    .from(inbound)
    .where(eq(inbound.householdId, p.householdId))
    .orderBy(desc(inbound.createdAt))
    .limit(10);
  return {
    available: !!domain,
    enabled: !!row && !!domain,
    address: row && domain ? importAddress(row.token, domain) : null,
    since: row?.createdAt ?? null,
    recent,
  };
}

/** Turns email import on, or gives the household a new address (the old one stops working at once). */
export async function regenerateEmailImport(db: Database, p: Principal, domain: string | null) {
  if (!domain) notConfigured();
  const token = newImportToken();
  await db
    .insert(addr)
    .values({ householdId: p.householdId, token, createdBy: p.userId })
    .onConflictDoUpdate({ target: addr.householdId, set: { token, createdBy: p.userId, createdAt: new Date() } });
  return emailImportStatus(db, p, domain);
}

export async function disableEmailImport(db: Database, p: Principal, domain: string | null) {
  await db.delete(addr).where(eq(addr.householdId, p.householdId));
  return emailImportStatus(db, p, domain);
}

// ------------------------------------------------------------------------------------------------ receiving

export type InboundMessage = {
  /** Envelope sender (MAIL FROM). */
  from: string;
  /** Envelope recipient. */
  to: string;
  raw: RawEmail;
};

export type InboundOutcome =
  /** Not an import address we know: bounce. */
  | { action: "reject"; reason: string }
  /** Logged, nothing to send (sender not a member, Gmail's forwarding confirmation, auto-generated mail). */
  | { action: "drop"; status: InboundStatus }
  /** Answer the sender (the Worker's message.reply() threads it under their email). */
  | { action: "reply"; status: InboundStatus; subject: string; text: string };

export type FileResult = {
  name: string;
  ok: boolean;
  kind?: "jago" | "gopay";
  message?: string;
  period?: { from: string; to: string } | null;
  newRows?: number;
  duplicates?: number;
  verified?: boolean;
  uncategorized?: number;
  /** GoPay: Jago payments that got their merchant. */
  named?: number;
};

const isPdf = (a: Attachment) => a.mimeType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(a.filename ?? "");

function bytesOf(a: Attachment): Uint8Array {
  if (typeof a.content === "string") return new TextEncoder().encode(a.content);
  return a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content);
}

async function logInbound(db: Database, householdId: string, row: { fromAddress: string; userId: string | null; subject: string | null; status: InboundStatus; detail: unknown }) {
  await db.insert(inbound).values({ id: crypto.randomUUID(), householdId, ...row, subject: row.subject?.slice(0, 200) ?? null });
  // Keep the newest rows only; the import batches themselves stay in import_batch.
  const keep = db.select({ id: inbound.id }).from(inbound).where(eq(inbound.householdId, householdId)).orderBy(desc(inbound.createdAt)).limit(KEEP_INBOUND);
  await db.delete(inbound).where(and(eq(inbound.householdId, householdId), notInArray(inbound.id, keep)));
}

/** Gmail sends "(#123456789) Gmail Forwarding Confirmation" before it forwards anything; members need that code. */
function forwardingCode(subject: string, text: string): string | null {
  return /\(#(\d{6,})\)/.exec(subject)?.[1] ?? /Confirmation code:\s*(\d{6,})/i.exec(text)?.[1] ?? null;
}

async function importPdf(db: Database, p: Principal, name: string, bytes: Uint8Array): Promise<FileResult> {
  if (bytes.byteLength > MAX_PDF_BYTES) return { name, ok: false, message: "Too large (over 15 MB)." };
  const read = await pdfText(bytes);
  if (!read.ok) {
    return {
      name,
      ok: false,
      message: read.reason === "encrypted" ? "Password-protected PDF. Email import cannot open these yet; upload it in the JoyoArto app instead." : read.message,
    };
  }
  try {
    const r = await importStatement(db, p, { text: read.text, fileName: name.slice(0, 200), commit: true }, { source: "email" });
    if (r.kind === "jago") {
      return {
        name,
        ok: r.committed,
        kind: "jago",
        period: r.period,
        newRows: r.totals.inserted,
        duplicates: r.totals.duplicates,
        verified: r.balancesVerified,
        uncategorized: r.totals.uncategorized,
        ...(r.committed ? {} : { message: "The balances do not add up, so nothing was saved. Upload it in the app, or report it." }),
      };
    }
    return {
      name,
      ok: true,
      kind: "gopay",
      period: r.period,
      newRows: r.wallet.inserted,
      duplicates: r.wallet.duplicates,
      verified: r.totalsVerified,
      uncategorized: r.wallet.uncategorized,
      named: r.bankPaymentsNamed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Expected refusals (not a statement we read, no rows) carry a status; anything else is a bug worth logging.
    if (!(error as { status?: number }).status) console.error("email import", error);
    return { name, ok: false, message };
  }
}

const KIND_NAME = { jago: "Bank Jago statement", gopay: "GoPay e-statement" } as const;

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function summaryText(files: FileResult[], skipped: number, appUrl: string | null): string {
  const out: string[] = [];
  for (const f of files) {
    if (!f.ok) {
      out.push(`✗ ${f.name}${f.kind ? ` (${KIND_NAME[f.kind]})` : ""}`, `  ${f.message ?? "Not imported."}`, "");
      continue;
    }
    const period = f.period ? `, ${fmtDay(f.period.from)} – ${fmtDay(f.period.to)}` : "";
    out.push(`✓ ${f.name}: ${KIND_NAME[f.kind!]}${period}`);
    const parts = [`${f.newRows} new`, `${f.duplicates} already imported`];
    if (f.kind === "gopay") parts.unshift(`${f.named ?? 0} Jago payments named`);
    out.push(`  ${parts.join(", ")}.`);
    out.push(`  ${f.verified ? (f.kind === "jago" ? "Every running balance checked." : "Totals checked.") : "Totals not verified; check the rows."} ${f.uncategorized ?? 0} uncategorized.`, "");
  }
  if (skipped) out.push(`${skipped} more PDF${skipped > 1 ? "s were" : " was"} not read (at most ${MAX_PDFS_PER_EMAIL} per email).`, "");
  if (appUrl && files.some((f) => f.ok && (f.uncategorized ?? 0) > 0)) out.push(`Categorise them: ${appUrl.replace(/\/$/, "")}/transactions?uncategorized=true`, "");
  out.push("JoyoArto reads Bank Jago monthly statements and GoPay e-statements by email. Other banks: CSV import in the app, or ask Claude.");
  return out.join("\n");
}

export async function receiveEmail(db: Database, msg: InboundMessage, config: { domain: string | null; appUrl?: string | null }): Promise<InboundOutcome> {
  const token = config.domain ? tokenFromRecipient(msg.to, config.domain) : null;
  const [target] = token ? await db.select().from(addr).where(eq(addr.token, token)) : [];
  if (!target) return { action: "reject", reason: "Unknown address" };
  const householdId = target.householdId;

  const email = await PostalMime.parse(msg.raw, { maxPartCount: 200 });
  const subject = email.subject ?? "";
  const from = msg.from.trim().toLowerCase();
  const auth: SenderAuth = senderAuth(email.headers, from);

  if (mailbox(from) === "forwarding-noreply@google.com" && auth !== "fail") {
    const code = forwardingCode(subject, email.text ?? "");
    if (code) {
      await logInbound(db, householdId, { fromAddress: from, userId: null, subject, status: "forwarding_confirmation", detail: { code } });
      return { action: "drop", status: "forwarding_confirmation" };
    }
  }

  const members = await db
    .select({ userId: schema.householdMember.userId, email: schema.user.email })
    .from(schema.householdMember)
    .innerJoin(schema.user, eq(schema.user.id, schema.householdMember.userId))
    .where(eq(schema.householdMember.householdId, householdId));
  const member = members.find((m) => mailbox(m.email) === mailbox(from));
  if (!member || auth === "fail") {
    await logInbound(db, householdId, {
      fromAddress: from,
      userId: member?.userId ?? null,
      subject,
      status: "rejected_sender",
      detail: { reason: member ? "The sender's domain did not authenticate (SPF/DKIM/DMARC)." : "Not a member's email address.", auth },
    });
    // No reply: it would tell a stranger the address exists.
    return { action: "drop", status: "rejected_sender" };
  }

  const p: Principal = { userId: member.userId, householdId, scopes: ["finance:read", "finance:write"], via: "email" };
  const pdfs = email.attachments.filter(isPdf);
  const reSubject = `Re: ${subject || "statement"}`.slice(0, 200);
  // Never answer automatic mail (out-of-office, bounces): that is how mail loops start.
  const automatic = email.headers.some((h) => h.key === "auto-submitted" && !/^no\b/i.test(h.value.trim())) || /mailer-daemon|postmaster/i.test(from);
  const reply = (status: InboundStatus, text: string): InboundOutcome =>
    automatic ? { action: "drop", status } : { action: "reply", status, subject: reSubject, text };

  if (!pdfs.length) {
    await logInbound(db, householdId, { fromAddress: from, userId: member.userId, subject, status: "no_pdf", detail: { attachments: email.attachments.length, auth } });
    return reply("no_pdf", "No PDF attached, so nothing was imported.\n\nAttach the statement PDF (Bank Jago monthly statement or GoPay e-statement) and send it again.");
  }

  const files: FileResult[] = [];
  for (const [i, a] of pdfs.slice(0, MAX_PDFS_PER_EMAIL).entries()) {
    files.push(await importPdf(db, p, a.filename?.trim() || `attachment-${i + 1}.pdf`, bytesOf(a)));
  }
  const skipped = Math.max(0, pdfs.length - MAX_PDFS_PER_EMAIL);
  const okCount = files.filter((f) => f.ok).length;
  const status: InboundStatus = okCount === files.length && !skipped ? "imported" : okCount ? "partial" : "failed";
  await logInbound(db, householdId, { fromAddress: from, userId: member.userId, subject, status, detail: { files, skipped, auth } });
  return reply(status, summaryText(files, skipped, config.appUrl ?? null));
}
