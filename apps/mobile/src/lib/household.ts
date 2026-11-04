// Household screen rules (web: routes/-household.tsx): what an owner may do with each member, and the invite link to
// share. The server enforces all of it; this only avoids offering what it would refuse. Pure, unit-tested.

export type Role = "owner" | "member";
export type MemberLike = { userId: string; role: string; you: boolean };

export type MemberAction = "makeOwner" | "makeMember" | "remove" | "leave";

/** The household keeps at least one owner. */
export function isLastOwner(m: MemberLike, members: readonly MemberLike[]): boolean {
  return m.role === "owner" && members.filter((x) => x.role === "owner").length === 1;
}

/** What the signed-in member (`yourRole`) can do with `m`. */
export function memberActions(m: MemberLike, members: readonly MemberLike[], yourRole: string): MemberAction[] {
  const last = isLastOwner(m, members);
  const out: MemberAction[] = [];
  if (yourRole === "owner") {
    if (m.role === "member") out.push("makeOwner");
    else if (!last) out.push("makeMember");
  }
  if (m.you) {
    if (members.length > 1 && !last) out.push("leave");
  } else if (yourRole === "owner" && !last) out.push("remove");
  return out;
}

export function inviteUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, "")}${path}`;
}

/** The text the share sheet sends with the link. */
export function inviteMessage(householdName: string, url: string): string {
  return `Join "${householdName}" on JoyoArto to see our household's money together. The link works for 14 days, only for the Google account it was made for:\n${url}`;
}

export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
