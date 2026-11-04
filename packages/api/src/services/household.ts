import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Principal } from "../context";
import type { BillingConfig } from "../lib/billing/config";
import { setDefaultHousehold } from "../lib/household";
import type { Role } from "../lib/members";
import {
  MAX_PENDING_INVITES,
  inviteExpiry,
  inviteStatus,
  isDisposableHousehold,
  lastOwnerProblem,
  normalizeEmail,
  randomInviteToken,
  sha256Hex,
} from "../lib/members";
import { assertMemberSeat } from "./billing";
import { badRequest, notFound } from "./common";

const hm = schema.householdMember;
const inv = schema.householdInvite;

function forbidden(message: string): never {
  throw new ORPCError("FORBIDDEN", { message });
}

async function members(db: Database, householdId: string) {
  return db
    .select({
      userId: hm.userId,
      role: hm.role,
      joinedAt: hm.createdAt,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(hm)
    .innerJoin(schema.user, eq(schema.user.id, hm.userId))
    .where(eq(hm.householdId, householdId))
    .orderBy(asc(hm.createdAt));
}

async function roleOf(db: Database, householdId: string, userId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: hm.role })
    .from(hm)
    .where(and(eq(hm.householdId, householdId), eq(hm.userId, userId)));
  return row?.role ?? null;
}

async function requireOwner(db: Database, p: Principal): Promise<void> {
  if ((await roleOf(db, p.householdId, p.userId)) !== "owner") forbidden("Only an owner of this household can do that.");
}

/** The active household: name, your role, members, and (for owners) pending invites. */
export async function householdInfo(db: Database, p: Principal) {
  const [h] = await db.select().from(schema.household).where(eq(schema.household.id, p.householdId));
  if (!h) notFound("Household");
  const list = await members(db, p.householdId);
  const role = list.find((m) => m.userId === p.userId)?.role ?? "member";
  const invites =
    role === "owner"
      ? await db
          .select({
            id: inv.id,
            email: inv.email,
            role: inv.role,
            expiresAt: inv.expiresAt,
            createdAt: inv.createdAt,
            invitedBy: schema.user.name,
          })
          .from(inv)
          .leftJoin(schema.user, eq(schema.user.id, inv.invitedBy))
          .where(and(eq(inv.householdId, p.householdId), isNull(inv.acceptedAt), gt(inv.expiresAt, new Date())))
          .orderBy(asc(inv.createdAt))
      : [];
  return {
    household: { id: h.id, name: h.name, baseCurrency: h.baseCurrency },
    yourRole: role,
    members: list.map((m) => ({ ...m, you: m.userId === p.userId })),
    pendingInvites: invites,
  };
}

/** Every household the user belongs to; `active` is the one requests act in. */
export async function listHouseholds(db: Database, p: Principal) {
  const mine = await db
    .select({
      id: schema.household.id,
      name: schema.household.name,
      role: hm.role,
      joinedAt: hm.createdAt,
    })
    .from(hm)
    .innerJoin(schema.household, eq(schema.household.id, hm.householdId))
    .where(eq(hm.userId, p.userId))
    .orderBy(asc(hm.createdAt));
  return { households: mine.map((h) => ({ ...h, active: h.id === p.householdId })) };
}

export const switchInput = z.object({ householdId: z.string() });

export async function switchHousehold(db: Database, p: Principal, input: z.infer<typeof switchInput>) {
  if (!(await roleOf(db, input.householdId, p.userId))) notFound(`Household ${input.householdId}`);
  await setDefaultHousehold(db, p.userId, input.householdId);
  return { active: input.householdId };
}

export const renameInput = z.object({ name: z.string().trim().min(1).max(80) });

export async function renameHousehold(db: Database, p: Principal, input: z.infer<typeof renameInput>) {
  await requireOwner(db, p);
  await db.update(schema.household).set({ name: input.name }).where(eq(schema.household.id, p.householdId));
  return { id: p.householdId, name: input.name };
}

export const inviteInput = z.object({
  email: z.email().max(254),
  role: z.enum(schema.HOUSEHOLD_ROLES).default("member"),
});

/**
 * Invites an email address to the active household. Returns the token once; the link is /join/<token>. Inviting an
 * address that already has a pending invite replaces it (the old link stops working).
 */
export async function createInvite(db: Database, p: Principal, input: z.infer<typeof inviteInput>, billing?: BillingConfig) {
  await requireOwner(db, p);
  const email = normalizeEmail(input.email);
  const current = await members(db, p.householdId);
  if (current.some((m) => m.email.toLowerCase() === email)) badRequest(`${email} is already a member of this household.`);
  // Re-inviting an address replaces its pending invite, so it takes no new seat.
  const [again] = await db
    .select({ id: inv.id })
    .from(inv)
    .where(and(eq(inv.householdId, p.householdId), eq(inv.email, email), isNull(inv.acceptedAt), gt(inv.expiresAt, new Date())));
  if (!again) await assertMemberSeat(db, p.householdId, p.userId, billing, { countPending: true });
  const now = new Date();
  const [pending] = await db
    .select({ n: count() })
    .from(inv)
    .where(and(eq(inv.householdId, p.householdId), isNull(inv.acceptedAt), gt(inv.expiresAt, now)));
  if ((pending?.n ?? 0) >= MAX_PENDING_INVITES) badRequest("Too many pending invites; revoke some first.");

  const token = randomInviteToken();
  const row = {
    id: crypto.randomUUID(),
    householdId: p.householdId,
    email,
    role: input.role,
    tokenHash: await sha256Hex(token),
    invitedBy: p.userId,
    expiresAt: inviteExpiry(now),
  };
  await db.batch([db.delete(inv).where(and(eq(inv.householdId, p.householdId), eq(inv.email, email), isNull(inv.acceptedAt))), db.insert(inv).values(row)]);
  return {
    id: row.id,
    email,
    role: row.role,
    expiresAt: row.expiresAt,
    token,
    path: `/join/${token}`,
    note: "Shown once. Send the link to them now.",
  };
}

export async function revokeInvite(db: Database, p: Principal, id: string) {
  await requireOwner(db, p);
  const res = await db
    .delete(inv)
    .where(and(eq(inv.id, id), eq(inv.householdId, p.householdId), isNull(inv.acceptedAt)))
    .returning({ id: inv.id });
  if (!res.length) notFound(`Invite ${id}`);
  return { revoked: id };
}

export const tokenInput = z.object({ token: z.string().min(10).max(200) });

async function findInvite(db: Database, token: string) {
  const [row] = await db
    .select({ invite: inv, householdName: schema.household.name, inviterName: schema.user.name })
    .from(inv)
    .innerJoin(schema.household, eq(schema.household.id, inv.householdId))
    .leftJoin(schema.user, eq(schema.user.id, inv.invitedBy))
    .where(eq(inv.tokenHash, await sha256Hex(token)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "This invite link is invalid or was revoked." });
  return row;
}

async function emailOf(db: Database, userId: string): Promise<string> {
  const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  return normalizeEmail(u?.email ?? "");
}

/** What the /join page shows before accepting. */
export async function previewInvite(db: Database, p: Principal, input: z.infer<typeof tokenInput>) {
  const { invite, householdName, inviterName } = await findInvite(db, input.token);
  const email = await emailOf(db, p.userId);
  return {
    household: householdName,
    invitedBy: inviterName,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    status: inviteStatus(invite),
    signedInAs: email,
    emailMatches: email === invite.email,
    alreadyMember: (await roleOf(db, invite.householdId, p.userId)) !== null,
  };
}

/**
 * Joins the invite's household and makes it the active one. The signed-in email must be the invited one. The
 * household the user leaves behind is deleted when it is an untouched personal one (see isDisposableHousehold).
 */
export async function acceptInvite(db: Database, p: Principal, input: z.infer<typeof tokenInput>, billing?: BillingConfig) {
  const { invite, householdName } = await findInvite(db, input.token);
  const status = inviteStatus(invite);
  if (status === "accepted") badRequest("This invite was already used.");
  if (status === "expired") badRequest("This invite has expired. Ask for a new one.");
  const email = await emailOf(db, p.userId);
  if (email !== invite.email) {
    forbidden(`This invite is for ${invite.email}, but you are signed in as ${email || "another account"}. Sign in with ${invite.email} to accept it.`);
  }

  // The invite held a seat under the inviter's plan, which may have gone back to Free since.
  if (!(await roleOf(db, invite.householdId, p.userId))) await assertMemberSeat(db, invite.householdId, invite.invitedBy, billing, { countPending: false });

  // Claim it first, so a link opened twice cannot add a membership twice.
  const claimed = await db
    .update(inv)
    .set({ acceptedAt: new Date(), acceptedBy: p.userId })
    .where(and(eq(inv.id, invite.id), isNull(inv.acceptedAt), gt(inv.expiresAt, new Date())))
    .returning({ id: inv.id });
  if (!claimed.length) badRequest("This invite was already used.");

  const previous = p.householdId;
  try {
    if (!(await roleOf(db, invite.householdId, p.userId))) {
      await db.insert(hm).values({ householdId: invite.householdId, userId: p.userId, role: invite.role });
    }
    await setDefaultHousehold(db, p.userId, invite.householdId);
  } catch (error) {
    await db.update(inv).set({ acceptedAt: null, acceptedBy: null }).where(eq(inv.id, invite.id));
    throw error;
  }

  const removedEmptyHousehold = await dropIfDisposable(db, p.userId, previous, invite.householdId);
  return {
    householdId: invite.householdId,
    household: householdName,
    role: invite.role,
    removedEmptyHousehold,
  };
}

async function dropIfDisposable(db: Database, userId: string, householdId: string, joiningHouseholdId: string): Promise<boolean> {
  const [[mine], [memberCount], [accountCount], [transactionCount]] = await db.batch([
    db
      .select({ role: hm.role })
      .from(hm)
      .where(and(eq(hm.householdId, householdId), eq(hm.userId, userId))),
    db.select({ n: count() }).from(hm).where(eq(hm.householdId, householdId)),
    db.select({ n: count() }).from(schema.finAccount).where(eq(schema.finAccount.householdId, householdId)),
    db.select({ n: count() }).from(schema.transaction).where(eq(schema.transaction.householdId, householdId)),
  ]);
  if (
    !mine ||
    !isDisposableHousehold({
      householdId,
      joiningHouseholdId,
      role: mine.role,
      memberCount: memberCount?.n ?? 0,
      accountCount: accountCount?.n ?? 0,
      transactionCount: transactionCount?.n ?? 0,
    })
  ) {
    return false;
  }
  await moveScenarios(db, householdId, joiningHouseholdId);
  await db.delete(schema.household).where(eq(schema.household.id, householdId));
  return true;
}

/** Saved plan scenarios outlive the empty personal household they were made in: they move to the joined one. */
async function moveScenarios(db: Database, from: string, to: string) {
  const ps = schema.planScenario;
  const [mine, theirs] = await db.batch([
    db.select({ id: ps.id, name: ps.name }).from(ps).where(eq(ps.householdId, from)),
    db.select({ name: ps.name }).from(ps).where(eq(ps.householdId, to)),
  ]);
  const taken = new Set(theirs.map((x) => x.name));
  for (const s of mine) {
    let name = s.name;
    for (let n = 2; taken.has(name); n++) name = `${s.name.slice(0, 54)} (${n})`;
    taken.add(name);
    await db.update(ps).set({ householdId: to, name }).where(and(eq(ps.id, s.id), eq(ps.householdId, from)));
  }
}

export const memberRoleInput = z.object({
  userId: z.string(),
  role: z.enum(schema.HOUSEHOLD_ROLES),
});

export async function setMemberRole(db: Database, p: Principal, input: z.infer<typeof memberRoleInput>) {
  await requireOwner(db, p);
  const list = await members(db, p.householdId);
  if (!list.some((m) => m.userId === input.userId)) notFound(`Member ${input.userId}`);
  const problem = lastOwnerProblem(list, input.userId, input.role);
  if (problem) badRequest(problem);
  await db
    .update(hm)
    .set({ role: input.role })
    .where(and(eq(hm.householdId, p.householdId), eq(hm.userId, input.userId)));
  return { userId: input.userId, role: input.role };
}

/** Removes a member (owners) or yourself (anyone). The household keeps at least one owner. */
export async function removeMember(db: Database, p: Principal, userId: string) {
  if (userId !== p.userId) await requireOwner(db, p);
  const list = await members(db, p.householdId);
  if (!list.some((m) => m.userId === userId)) notFound(`Member ${userId}`);
  const problem = lastOwnerProblem(list, userId, null);
  if (problem) badRequest(problem);
  // Their default moves to their oldest other household on their next request (ensureHousehold); with none left,
  // they get a fresh personal one.
  await db.delete(hm).where(and(eq(hm.householdId, p.householdId), eq(hm.userId, userId)));
  return { removed: userId, householdId: p.householdId };
}

export function leaveHousehold(db: Database, p: Principal) {
  return removeMember(db, p, p.userId);
}

/** Lets a person with a pending, unexpired invite sign up although they are not on ALLOWED_EMAILS. */
export async function hasPendingInvite(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: inv.id })
    .from(inv)
    .where(and(eq(inv.email, normalizeEmail(email)), isNull(inv.acceptedAt), gt(inv.expiresAt, new Date())))
    .limit(1);
  return Boolean(row);
}
