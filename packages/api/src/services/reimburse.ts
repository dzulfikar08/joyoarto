// Reimbursement ("Diganti kantor"): expenses paid personally that an employer pays back, the employer profiles, and
// the claim reports (PDF/CSV) the member emails or prints for approval. Nothing is ever sent to the employer.
//
// Accounting model. A reimbursable expense stays on the account that really paid it (GoPay, a card), so balances and
// statement reconciliation are untouched, but while it is draft, submitted or paid it is a TRANSFER into the
// employer's receivable account (one per profile, type "receivable"): not household spending, not in budgets, the
// dashboard or the Plan baseline (reports.ts kindExpr). The receivable's balance is what the employer still owes:
// the draft and submitted items. The employer's payment is the money-in row marked "payment" for the claim; it is a
// transfer out of the receivable, so it is not income. Rejected items are the household's own spending again.

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { FileStore, Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { wibMonth } from "../lib/billing/entitlement";
import { CLAIM_REPORT_METRIC } from "../lib/billing/plans";
import { claimPdf } from "../lib/claim-pdf";
import { chunk } from "../lib/d1";
import { todayWib } from "../lib/dashboard";
import { buildSnapshot, claimCsv, claimNumber, nextClaimSequence } from "../lib/reimburse";
import type { ClaimSnapshot } from "../lib/reimburse";
import { attachmentsByTransaction } from "./attachments";
import { upgradeRequired, userPlan } from "./billing";
import { accountsById, badRequest, baseCurrency, categoriesById, day, money, notFound } from "./common";
import { viewRows } from "./transactions";

const rp = schema.reimbursementProfile;
const rc = schema.reimbursementClaim;
const t = schema.transaction;
const a = schema.finAccount;

/** Statuses that keep a row out of household spending and income (everything but rejected). */
export const OPEN_STATUSES = ["draft", "submitted"] as const;

// ------------------------------------------------------------------------------------------------ profiles

export const profileInput = z.object({
  companyName: z.string().trim().min(1).max(80).describe("Who pays it back, e.g. \"PT Maju Jaya\""),
  claimantName: z.string().trim().min(1).max(80).optional().describe("Default: your name"),
  employeeId: z.string().trim().max(40).nullable().optional(),
  department: z.string().trim().max(80).nullable().optional(),
  approverName: z.string().trim().max(80).nullable().optional(),
  approverEmail: z.string().trim().email().max(120).nullable().optional().or(z.literal("").transform(() => null)),
  currency: z.string().length(3).default("IDR"),
});

export const profileUpdate = profileInput.partial().extend({ id: z.string() });

type ProfileRow = typeof rp.$inferSelect;

function profileView(r: ProfileRow, open?: { draft: number; draftCount: number; submitted: number; submittedCount: number }) {
  return {
    id: r.id,
    companyName: r.companyName,
    claimantName: r.claimantName,
    employeeId: r.employeeId,
    department: r.department,
    approverName: r.approverName,
    approverEmail: r.approverEmail,
    currency: r.currency,
    accountId: r.accountId,
    archived: r.archivedAt !== null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    /** Marked, not in a claim yet. */
    draft: { count: open?.draftCount ?? 0, ...money(open?.draft ?? 0, r.currency) },
    /** In a claim report, waiting for the employer. */
    submitted: { count: open?.submittedCount ?? 0, ...money(open?.submitted ?? 0, r.currency) },
    /** What the employer still owes (the receivable account's balance). */
    owed: money((open?.draft ?? 0) + (open?.submitted ?? 0), r.currency),
  };
}

/** Owed per profile: draft and submitted items (positive minor units). */
async function openTotals(db: Database, householdId: string) {
  const rows = await db
    .select({
      profileId: t.reimburseProfileId,
      draft: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'draft' then -${t.amount} else 0 end), 0)`,
      draftCount: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'draft' then 1 else 0 end), 0)`,
      submitted: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'submitted' then -${t.amount} else 0 end), 0)`,
      submittedCount: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'submitted' then 1 else 0 end), 0)`,
    })
    .from(t)
    .where(and(eq(t.householdId, householdId), inArray(t.reimburseStatus, [...OPEN_STATUSES])))
    .groupBy(t.reimburseProfileId);
  return new Map(rows.map((r) => [r.profileId ?? "", { draft: Number(r.draft), draftCount: Number(r.draftCount), submitted: Number(r.submitted), submittedCount: Number(r.submittedCount) }]));
}

/** What each receivable account holds: the owed total of its profile. accounts.ts adds it to the balance. */
export async function receivableBalances(db: Database, householdId: string): Promise<Map<string, number>> {
  const [profiles, open] = await Promise.all([
    db.select({ id: rp.id, accountId: rp.accountId }).from(rp).where(eq(rp.householdId, householdId)),
    openTotals(db, householdId),
  ]);
  const out = new Map<string, number>();
  for (const p of profiles) {
    if (!p.accountId) continue;
    const o = open.get(p.id);
    out.set(p.accountId, (out.get(p.accountId) ?? 0) + (o ? o.draft + o.submitted : 0));
  }
  return out;
}

export async function listProfiles(db: Database, p: Principal, input: { includeArchived?: boolean } = {}) {
  const where = input.includeArchived ? eq(rp.householdId, p.householdId) : and(eq(rp.householdId, p.householdId), isNull(rp.archivedAt));
  const [rows, open] = await Promise.all([db.select().from(rp).where(where).orderBy(desc(rp.lastUsedAt), asc(rp.createdAt)), openTotals(db, p.householdId)]);
  const profiles = rows.map((r) => profileView(r, open.get(r.id)));
  return { profiles, defaultProfileId: profiles.find((x) => !x.archived)?.id ?? null };
}

async function ownProfile(db: Database, householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(rp)
    .where(and(eq(rp.id, id), eq(rp.householdId, householdId)));
  return row ?? notFound(`Reimbursement profile ${id}`);
}

/** A profile and its receivable account (named after the company). */
export async function createProfile(db: Database, p: Principal, input: z.infer<typeof profileInput>) {
  const [u] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, p.userId));
  const id = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const currency = input.currency.toUpperCase();
  await db.batch([
    db.insert(a).values({ id: accountId, householdId: p.householdId, name: `Reimburse ${input.companyName}`.slice(0, 80), institution: "other", type: "receivable", currency }),
    db.insert(rp).values({
      id,
      householdId: p.householdId,
      companyName: input.companyName,
      claimantName: input.claimantName?.trim() || u?.name || "—",
      employeeId: input.employeeId || null,
      department: input.department || null,
      approverName: input.approverName || null,
      approverEmail: input.approverEmail || null,
      currency,
      accountId,
      createdBy: p.userId,
    }),
  ]);
  return profileView(await ownProfile(db, p.householdId, id));
}

export async function updateProfile(db: Database, p: Principal, input: z.infer<typeof profileUpdate>) {
  const row = await ownProfile(db, p.householdId, input.id);
  const { id, ...rest } = input;
  const patch: Partial<typeof rp.$inferInsert> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v === "" ? null : v;
  if (patch.currency) patch.currency = patch.currency.toUpperCase();
  if (!Object.keys(patch).length) badRequest("Nothing to change.");
  await db.update(rp).set(patch).where(eq(rp.id, id));
  if (row.accountId && (patch.companyName || patch.currency)) {
    await db
      .update(a)
      .set({ ...(patch.companyName ? { name: `Reimburse ${patch.companyName}`.slice(0, 80) } : {}), ...(patch.currency ? { currency: patch.currency } : {}) })
      .where(and(eq(a.id, row.accountId), eq(a.householdId, p.householdId)));
  }
  return profileView(await ownProfile(db, p.householdId, id));
}

/**
 * Removes a profile. One that was never used goes with its receivable account; one with items or claims is archived
 * (its reports stay downloadable) and refused while items are still open.
 */
export async function deleteProfile(db: Database, p: Principal, id: string) {
  const row = await ownProfile(db, p.householdId, id);
  const open = (await openTotals(db, p.householdId)).get(id);
  if (open && open.draftCount + open.submittedCount > 0) badRequest("This profile still has open items. Settle, reject or unmark them first.");
  const [[used], [claims]] = await db.batch([
    db.select({ n: sql<number>`count(*)` }).from(t).where(and(eq(t.householdId, p.householdId), eq(t.reimburseProfileId, id))),
    db.select({ n: sql<number>`count(*)` }).from(rc).where(eq(rc.profileId, id)),
  ]);
  if (!Number(used?.n) && !Number(claims?.n)) {
    await db.delete(rp).where(eq(rp.id, id));
    if (row.accountId) await db.delete(a).where(and(eq(a.id, row.accountId), eq(a.householdId, p.householdId), eq(a.type, "receivable")));
    return { deleted: id, archived: false };
  }
  const now = new Date();
  await db.update(rp).set({ archivedAt: now }).where(eq(rp.id, id));
  if (row.accountId) await db.update(a).set({ archivedAt: now }).where(and(eq(a.id, row.accountId), eq(a.householdId, p.householdId)));
  return { deleted: id, archived: true };
}

/** The profile to use when none is named: the most recently used one that is not archived. */
async function defaultProfile(db: Database, householdId: string) {
  const [row] = await db
    .select()
    .from(rp)
    .where(and(eq(rp.householdId, householdId), isNull(rp.archivedAt)))
    .orderBy(desc(rp.lastUsedAt), asc(rp.createdAt))
    .limit(1);
  return row ?? badRequest("Add a reimbursement profile first (Settings → Reimbursement): the company that pays it back.");
}

// ------------------------------------------------------------------------------------------------ items

export const markInput = z.object({
  ids: z.array(z.string()).min(1).max(200).describe("Transaction ids (money out)"),
  reimbursable: z.boolean().default(true).describe("false = an ordinary expense again (only items not in a claim)"),
  profileId: z.string().optional().describe("The company that pays it back; default: the most recently used profile"),
});

/**
 * Marks expenses reimbursable (draft, for a profile) or unmarks them. Items already in a claim (submitted, paid)
 * keep their status: reopen or delete the claim first. Rejected items can be marked again.
 */
export async function markReimbursable(db: Database, p: Principal, input: z.infer<typeof markInput>) {
  const rows: { id: string; amount: number; status: string | null }[] = [];
  for (const part of chunk(input.ids, 90)) {
    rows.push(
      ...(await db
        .select({ id: t.id, amount: t.amount, status: t.reimburseStatus })
        .from(t)
        .where(and(eq(t.householdId, p.householdId), inArray(t.id, part)))),
    );
  }
  if (rows.length !== new Set(input.ids).size) notFound("Some of those transactions were");
  const locked = rows.filter((r) => r.status === "submitted" || r.status === "paid" || r.status === "payment");
  if (locked.length) badRequest("Some of these are already in a claim report (or are an employer's payment). Change them from the Reimburse page.");
  if (!input.reimbursable) {
    for (const part of chunk(rows.map((r) => r.id), 90)) {
      await db.update(t).set({ reimburseStatus: null, reimburseProfileId: null, reimburseClaimId: null }).where(and(eq(t.householdId, p.householdId), inArray(t.id, part)));
    }
    return { updated: rows.length, profileId: null };
  }
  if (rows.some((r) => r.amount >= 0)) badRequest("Only money out can be reimbursable.");
  const profile = input.profileId ? await ownProfile(db, p.householdId, input.profileId) : await defaultProfile(db, p.householdId);
  if (profile.archivedAt) badRequest("That profile is archived.");
  for (const part of chunk(rows.map((r) => r.id), 90)) {
    await db.update(t).set({ reimburseStatus: "draft", reimburseProfileId: profile.id, reimburseClaimId: null }).where(and(eq(t.householdId, p.householdId), inArray(t.id, part)));
  }
  await db.update(rp).set({ lastUsedAt: new Date() }).where(eq(rp.id, profile.id));
  return { updated: rows.length, profileId: profile.id };
}

export const itemsInput = z.object({
  profileId: z.string().optional(),
  status: z.enum(["open", "draft", "submitted", "paid", "rejected", "all"]).default("open").describe("open = draft and submitted"),
  from: day.optional(),
  to: day.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

/** Reimbursable expenses, oldest first (the order a claim lists them), with their photos. */
export async function listItems(db: Database, p: Principal, input: z.infer<typeof itemsInput>) {
  const where: (SQL | undefined)[] = [eq(t.householdId, p.householdId)];
  const statuses = input.status === "open" ? [...OPEN_STATUSES] : input.status === "all" ? ["draft", "submitted", "paid", "rejected"] : [input.status];
  where.push(inArray(t.reimburseStatus, statuses as ("draft" | "submitted" | "paid" | "rejected")[]));
  if (input.profileId) where.push(eq(t.reimburseProfileId, input.profileId));
  if (input.from) where.push(gte(t.date, input.from));
  if (input.to) where.push(lte(t.date, input.to));
  const rows = await db
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(asc(t.date), asc(t.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const items = await viewRows(db, p.householdId, page);
  const totals = new Map<string, number>();
  for (const r of page) totals.set(r.currency, (totals.get(r.currency) ?? 0) - r.amount);
  return { items, total: [...totals].map(([currency, amount]) => ({ currency, ...money(amount, currency) })), more: rows.length > input.limit };
}

// ------------------------------------------------------------------------------------------------ claims

export const createClaimInput = z.object({
  profileId: z.string(),
  transactionIds: z.array(z.string()).min(1).max(200).optional().describe("The draft items to include; default: every draft item of the profile in the period"),
  from: day.optional(),
  to: day.optional(),
  notes: z.string().trim().max(1000).optional().describe("Purpose of the whole claim, printed on the report"),
});

async function assertClaimReport(db: Database, userId: string, config: BillingConfig | undefined, now = new Date()) {
  const { limits } = await userPlan(db, userId, config, { now });
  const limit = limits.claimReportsPerMonth;
  if (limit === null) return;
  const uc = schema.usageCounter;
  const [row] = await db
    .select({ count: uc.count })
    .from(uc)
    .where(and(eq(uc.userId, userId), eq(uc.metric, CLAIM_REPORT_METRIC), eq(uc.period, wibMonth(now))));
  if ((row?.count ?? 0) >= limit) {
    upgradeRequired("claimReports", `Free includes ${limit} claim report a month and this month's is used. Reports you made can still be downloaded.`, { limit, used: row?.count ?? 0 });
  }
}

async function countClaimReport(db: Database, userId: string, now = new Date()) {
  const uc = schema.usageCounter;
  await db
    .insert(uc)
    .values({ userId, metric: CLAIM_REPORT_METRIC, period: wibMonth(now), count: 1, updatedAt: now })
    .onConflictDoUpdate({ target: [uc.userId, uc.metric, uc.period], set: { count: sql`${uc.count} + 1`, updatedAt: now } });
}

function claimView(r: typeof rc.$inferSelect, profile?: { companyName: string } | null) {
  return {
    id: r.id,
    number: r.number,
    profileId: r.profileId,
    company: profile?.companyName ?? null,
    status: r.status,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    itemCount: r.itemCount,
    total: money(r.total, r.currency),
    currency: r.currency,
    notes: r.notes,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    /** GET these with the session or token (application/pdf, text/csv). */
    pdfPath: `/api/reimburse/claims/${r.id}/pdf`,
    csvPath: `/api/reimburse/claims/${r.id}/csv`,
  };
}

/**
 * A claim report from draft items: freezes what is printed, numbers it (RB-YYYY-NNNN), and marks the items
 * submitted. The PDF and CSV are then downloaded by id, as often as needed.
 */
export async function createClaim(db: Database, p: Principal, input: z.infer<typeof createClaimInput>, billing?: BillingConfig) {
  const profile = await ownProfile(db, p.householdId, input.profileId);
  const where: (SQL | undefined)[] = [eq(t.householdId, p.householdId), eq(t.reimburseProfileId, profile.id), eq(t.reimburseStatus, "draft")];
  if (input.from) where.push(gte(t.date, input.from));
  if (input.to) where.push(lte(t.date, input.to));
  const rows: (typeof t.$inferSelect)[] = [];
  if (input.transactionIds) {
    for (const part of chunk([...new Set(input.transactionIds)], 90)) rows.push(...(await db.select().from(t).where(and(...where, inArray(t.id, part)))));
    if (rows.length !== new Set(input.transactionIds).size) badRequest("Every item must be a draft reimbursable expense of this profile (not already in a claim).");
  } else rows.push(...(await db.select().from(t).where(and(...where)).limit(200)));
  if (!rows.length) badRequest("No draft items to claim for this profile in that period.");
  const currencies = new Set(rows.map((r) => r.currency));
  if (currencies.size > 1) badRequest(`A claim is in one currency; these items are in ${[...currencies].join(", ")}. Make one claim per currency.`);
  await assertClaimReport(db, p.userId, billing);

  const [cats, accounts, photos] = await Promise.all([
    categoriesById(db, p.householdId),
    accountsById(db, p.householdId),
    attachmentsByTransaction(db, p.householdId, rows.map((r) => r.id)),
  ]);
  const issuedOn = todayWib();
  const snapshot = buildSnapshot(
    {
      number: "",
      issuedOn,
      periodFrom: input.from,
      periodTo: input.to,
      currency: [...currencies][0]!,
      company: profile.companyName,
      claimant: { name: profile.claimantName, employeeId: profile.employeeId, department: profile.department },
      approver: { name: profile.approverName, email: profile.approverEmail },
      notes: input.notes?.trim() || null,
    },
    rows.map((r) => ({
      transactionId: r.id,
      date: r.date,
      merchant: r.merchant ?? r.description,
      description: r.merchant && r.description !== r.merchant ? r.description : (r.note?.split("\n")[0] ?? r.description),
      category: r.categoryId ? (cats.get(r.categoryId)?.name ?? null) : null,
      paidWith: accounts.get(r.accountId)?.name ?? "—",
      amount: -r.amount,
      note: r.note,
      attachmentIds: (photos.get(r.id) ?? []).map((x) => x.id),
    })),
  );

  const year = Number(issuedOn.slice(0, 4));
  const id = crypto.randomUUID();
  let number = "";
  for (let attempt = 0; attempt < 3 && !number; attempt++) {
    const used = await db
      .select({ n: rc.number })
      .from(rc)
      .where(and(eq(rc.householdId, p.householdId), like(rc.number, `RB-${year}-%`)));
    const candidate = claimNumber(year, nextClaimSequence(used.map((u) => u.n), year) + attempt);
    const saved: ClaimSnapshot = { ...snapshot, number: candidate };
    const res = await db
      .insert(rc)
      .values({
        id,
        householdId: p.householdId,
        profileId: profile.id,
        number: candidate,
        periodFrom: saved.periodFrom,
        periodTo: saved.periodTo,
        total: saved.total,
        currency: saved.currency,
        itemCount: saved.items.length,
        notes: saved.notes,
        snapshot: JSON.stringify(saved),
        createdBy: p.userId,
      })
      .onConflictDoNothing()
      .returning({ id: rc.id });
    if (res.length) number = candidate;
  }
  if (!number) throw new ORPCError("CONFLICT", { message: "Could not number the claim; try again." });
  for (const part of chunk(rows.map((r) => r.id), 90)) {
    await db.update(t).set({ reimburseStatus: "submitted", reimburseClaimId: id }).where(and(eq(t.householdId, p.householdId), inArray(t.id, part)));
  }
  await db.update(rp).set({ lastUsedAt: new Date() }).where(eq(rp.id, profile.id));
  await countClaimReport(db, p.userId);
  const [row] = await db.select().from(rc).where(eq(rc.id, id));
  return { claim: claimView(row!, profile) };
}

export const claimsInput = z.object({ profileId: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) });

export async function listClaims(db: Database, p: Principal, input: z.infer<typeof claimsInput>) {
  const where = input.profileId ? and(eq(rc.householdId, p.householdId), eq(rc.profileId, input.profileId)) : eq(rc.householdId, p.householdId);
  const [rows, profiles] = await Promise.all([
    db.select().from(rc).where(where).orderBy(desc(rc.createdAt)).limit(input.limit),
    db.select({ id: rp.id, companyName: rp.companyName }).from(rp).where(eq(rp.householdId, p.householdId)),
  ]);
  const byId = new Map(profiles.map((x) => [x.id, x]));
  return { claims: rows.map((r) => claimView(r, byId.get(r.profileId))) };
}

async function ownClaim(db: Database, householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(rc)
    .where(and(eq(rc.id, id), eq(rc.householdId, householdId)));
  return row ?? notFound(`Claim ${id}`);
}

/** A claim, its items as they are now (status may have changed since), and the payments recorded for it. */
export async function getClaim(db: Database, p: Principal, id: string) {
  const row = await ownClaim(db, p.householdId, id);
  const profile = await ownProfile(db, p.householdId, row.profileId);
  const [items, payments] = await Promise.all([
    db.select().from(t).where(and(eq(t.householdId, p.householdId), eq(t.reimburseClaimId, id), inArray(t.reimburseStatus, ["submitted", "paid", "rejected"]))).orderBy(asc(t.date)),
    db.select().from(t).where(and(eq(t.householdId, p.householdId), eq(t.reimburseClaimId, id), eq(t.reimburseStatus, "payment"))),
  ]);
  const paid = payments.reduce((s, x) => s + x.amount, 0);
  return {
    claim: claimView(row, profile),
    items: await viewRows(db, p.householdId, items),
    payments: await viewRows(db, p.householdId, payments),
    /** Payments recorded minus the claim's total (negative = the employer paid less). */
    difference: money(paid - row.total, row.currency),
  };
}

export async function claimPdfFile(db: Database, files: FileStore | undefined, p: Principal, id: string): Promise<File> {
  const row = await ownClaim(db, p.householdId, id);
  const snapshot = JSON.parse(row.snapshot) as ClaimSnapshot;
  const at = schema.attachment;
  const store = files;
  const bytes = await claimPdf(snapshot, async (attachmentId) => {
    if (!store) return null;
    const [ref] = await db
      .select({ key: at.r2Key, mime: at.mime })
      .from(at)
      .where(and(eq(at.id, attachmentId), eq(at.householdId, p.householdId)));
    if (!ref) return null;
    const obj = await store.get(ref.key);
    return obj ? { bytes: obj.body, mime: ref.mime } : null;
  });
  return new File([bytes as unknown as ArrayBuffer], `${row.number}.pdf`, { type: "application/pdf" });
}

export async function claimCsvFile(db: Database, p: Principal, id: string): Promise<File> {
  const row = await ownClaim(db, p.householdId, id);
  return new File([claimCsv(JSON.parse(row.snapshot) as ClaimSnapshot)], `${row.number}.csv`, { type: "text/csv; charset=utf-8" });
}

export const claimStatusInput = z.object({
  id: z.string(),
  status: z.enum(["submitted", "paid", "rejected"]).describe("paid: the employer paid; rejected: refused (items count as your own spending again); submitted: undo"),
  paymentTransactionId: z.string().optional().describe("paid only: the money-in transaction that is the employer's payment (it then counts as a transfer, not income)"),
  rejectIds: z.array(z.string()).max(200).optional().describe("paid only: items of the claim the employer did not pay (rejected; the rest is paid)"),
});

/** Settles (paid), rejects or reopens a claim, and its items with it. */
export async function setClaimStatus(db: Database, p: Principal, input: z.infer<typeof claimStatusInput>) {
  const claim = await ownClaim(db, p.householdId, input.id);
  const scope = and(eq(t.householdId, p.householdId), eq(t.reimburseClaimId, claim.id));
  if (input.status === "submitted") {
    await db.batch([
      db.update(t).set({ reimburseStatus: "submitted" }).where(and(scope, inArray(t.reimburseStatus, ["paid", "rejected"]))),
      db.update(t).set({ reimburseStatus: null, reimburseProfileId: null, reimburseClaimId: null }).where(and(scope, eq(t.reimburseStatus, "payment"))),
      db.update(rc).set({ status: "submitted", paidAt: null }).where(eq(rc.id, claim.id)),
    ]);
  } else if (input.status === "rejected") {
    await db.batch([
      db.update(t).set({ reimburseStatus: "rejected" }).where(and(scope, inArray(t.reimburseStatus, ["submitted", "paid"]))),
      db.update(rc).set({ status: "rejected", paidAt: null }).where(eq(rc.id, claim.id)),
    ]);
  } else {
    if (input.paymentTransactionId) {
      const [pay] = await db
        .select()
        .from(t)
        .where(and(eq(t.id, input.paymentTransactionId), eq(t.householdId, p.householdId)));
      if (!pay) notFound(`Transaction ${input.paymentTransactionId}`);
      if (pay.amount <= 0) badRequest("The payment must be money in.");
      if (pay.reimburseStatus && !(pay.reimburseStatus === "payment" && pay.reimburseClaimId === claim.id)) badRequest("That transaction is already part of a reimbursement.");
      await db.update(t).set({ reimburseStatus: "payment", reimburseProfileId: claim.profileId, reimburseClaimId: claim.id }).where(eq(t.id, pay.id));
    }
    // Items named in rejectIds are rejected; every other item of the claim is paid.
    const named = new Set(input.rejectIds ?? []);
    const current = await db
      .select({ id: t.id })
      .from(t)
      .where(and(scope, inArray(t.reimburseStatus, ["submitted", "paid", "rejected"])));
    const toReject = current.filter((r) => named.has(r.id)).map((r) => r.id);
    const toPay = current.filter((r) => !named.has(r.id)).map((r) => r.id);
    for (const part of chunk(toReject, 90)) await db.update(t).set({ reimburseStatus: "rejected" }).where(and(scope, inArray(t.id, part)));
    for (const part of chunk(toPay, 90)) await db.update(t).set({ reimburseStatus: "paid" }).where(and(scope, inArray(t.id, part)));
    await db.update(rc).set({ status: "paid", paidAt: new Date() }).where(eq(rc.id, claim.id));
  }
  return getClaim(db, p, claim.id);
}

/** Withdraws a claim that is still submitted: its items go back to draft; the report is deleted. */
export async function deleteClaim(db: Database, p: Principal, id: string) {
  const claim = await ownClaim(db, p.householdId, id);
  if (claim.status !== "submitted") badRequest("Only a claim waiting for the employer can be withdrawn. Reopen it first.");
  await db.batch([
    db.update(t).set({ reimburseStatus: "draft", reimburseClaimId: null }).where(and(eq(t.householdId, p.householdId), eq(t.reimburseClaimId, claim.id), eq(t.reimburseStatus, "submitted"))),
    db.delete(rc).where(eq(rc.id, claim.id)),
  ]);
  return { deleted: id, number: claim.number };
}

/** The dashboard's line: open items across profiles, in the base currency. */
export async function openSummary(db: Database, householdId: string) {
  const cur = await baseCurrency(db, householdId);
  const [row] = await db
    .select({
      draft: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'draft' then 1 else 0 end), 0)`,
      submitted: sql<number>`coalesce(sum(case when ${t.reimburseStatus} = 'submitted' then 1 else 0 end), 0)`,
      owed: sql<number>`coalesce(sum(-${t.amount}), 0)`,
    })
    .from(t)
    .where(and(eq(t.householdId, householdId), eq(t.currency, cur), inArray(t.reimburseStatus, [...OPEN_STATUSES])));
  return { draft: Number(row?.draft ?? 0), submitted: Number(row?.submitted ?? 0), owed: money(Number(row?.owed ?? 0), cur) };
}
