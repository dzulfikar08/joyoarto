// Pure rules of household membership and invites (no database), so they can be unit tested.

export type Role = "owner" | "member";

export const INVITE_TTL_DAYS = 14;
export const INVITE_PREFIX = "inv_";
/** Pending invites one household may have at a time. */
export const MAX_PENDING_INVITES = 20;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type InviteStatus = "pending" | "accepted" | "expired";

export function inviteStatus(invite: { acceptedAt: Date | null; expiresAt: Date }, now = new Date()): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

export function inviteExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

/**
 * Why a membership change would leave the household without an owner, or null when it is fine.
 * `nextRole` null means the member leaves or is removed.
 */
export function lastOwnerProblem(members: { userId: string; role: Role }[], userId: string, nextRole: Role | null): string | null {
  const target = members.find((m) => m.userId === userId);
  if (!target || target.role !== "owner" || nextRole === "owner") return null;
  const owners = members.filter((m) => m.role === "owner").length;
  if (owners > 1) return null;
  return nextRole === null
    ? "The last owner cannot leave or be removed. Make another member an owner first."
    : "The last owner cannot become a member. Make another member an owner first.";
}

/**
 * Whether the household a user leaves behind when they join another one should be deleted: only an untouched
 * personal household (they own it alone and it holds no accounts or transactions), never the one they join.
 */
export function isDisposableHousehold(h: {
  householdId: string;
  joiningHouseholdId: string;
  role: Role;
  memberCount: number;
  accountCount: number;
  transactionCount: number;
}): boolean {
  return h.householdId !== h.joiningHouseholdId && h.role === "owner" && h.memberCount === 1 && h.accountCount === 0 && h.transactionCount === 0;
}

/** Random invite token: "inv_" + 40 base62 characters. */
export function randomInviteToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  return INVITE_PREFIX + Array.from(bytes, (b) => alphabet[b % 62]).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
