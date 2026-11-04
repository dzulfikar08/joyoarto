import { expect, test } from "bun:test";

import {
  INVITE_PREFIX,
  INVITE_TTL_DAYS,
  inviteExpiry,
  inviteStatus,
  isDisposableHousehold,
  lastOwnerProblem,
  normalizeEmail,
  randomInviteToken,
  sha256Hex,
} from "./members";

test("emails compare case-insensitively", () => {
  expect(normalizeEmail("  Siti.Aminah@Gmail.COM ")).toBe("siti.aminah@gmail.com");
});

test("invite status", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  const later = new Date("2026-11-05T00:00:00Z");
  expect(inviteStatus({ acceptedAt: null, expiresAt: later }, now)).toBe("pending");
  expect(inviteStatus({ acceptedAt: null, expiresAt: now }, now)).toBe("expired");
  expect(inviteStatus({ acceptedAt: now, expiresAt: new Date(0) }, now)).toBe("accepted");
  expect(inviteExpiry(now).getTime() - now.getTime()).toBe(INVITE_TTL_DAYS * 86_400_000);
});

test("a household always keeps an owner", () => {
  const solo = [{ userId: "a", role: "owner" as const }];
  const pair = [...solo, { userId: "b", role: "member" as const }];
  const twoOwners = [...solo, { userId: "b", role: "owner" as const }];
  expect(lastOwnerProblem(solo, "a", null)).toContain("last owner");
  expect(lastOwnerProblem(pair, "a", "member")).toContain("last owner");
  expect(lastOwnerProblem(pair, "a", "owner")).toBeNull();
  expect(lastOwnerProblem(pair, "b", null)).toBeNull();
  expect(lastOwnerProblem(pair, "b", "owner")).toBeNull();
  expect(lastOwnerProblem(twoOwners, "a", null)).toBeNull();
  expect(lastOwnerProblem(twoOwners, "a", "member")).toBeNull();
  expect(lastOwnerProblem(pair, "nobody", null)).toBeNull();
});

test("only an untouched personal household is dropped on joining another", () => {
  const empty = {
    householdId: "mine",
    joiningHouseholdId: "family",
    role: "owner" as const,
    memberCount: 1,
    accountCount: 0,
    transactionCount: 0,
  };
  expect(isDisposableHousehold(empty)).toBe(true);
  expect(isDisposableHousehold({ ...empty, transactionCount: 1 })).toBe(false);
  expect(isDisposableHousehold({ ...empty, accountCount: 1 })).toBe(false);
  expect(isDisposableHousehold({ ...empty, memberCount: 2 })).toBe(false);
  expect(isDisposableHousehold({ ...empty, role: "member" })).toBe(false);
  expect(isDisposableHousehold({ ...empty, joiningHouseholdId: "mine" })).toBe(false);
});

test("invite tokens are random and only their hash is comparable", async () => {
  const a = randomInviteToken();
  const b = randomInviteToken();
  expect(a.startsWith(INVITE_PREFIX)).toBe(true);
  expect(a).toMatch(/^inv_[A-Za-z0-9]{40}$/);
  expect(a).not.toBe(b);
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
