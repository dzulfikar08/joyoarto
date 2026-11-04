import { expect, test } from "bun:test";

import { inviteMessage, inviteUrl, isLastOwner, looksLikeEmail, memberActions } from "./household";

const me = { userId: "me", role: "owner", you: true };
const ana = { userId: "ana", role: "member", you: false };
const budi = { userId: "budi", role: "owner", you: false };

test("the last owner is protected", () => {
  expect(isLastOwner(me, [me, ana])).toBe(true);
  expect(isLastOwner(me, [me, budi])).toBe(false);
  expect(memberActions(me, [me, ana], "owner")).toEqual([]);
  expect(memberActions(me, [me], "owner")).toEqual([]);
  expect(memberActions(me, [me, budi], "owner")).toEqual(["makeMember", "leave"]);
});

test("owners manage others; members only leave", () => {
  expect(memberActions(ana, [me, ana], "owner")).toEqual(["makeOwner", "remove"]);
  expect(memberActions(budi, [me, budi], "owner")).toEqual(["makeMember", "remove"]);
  expect(memberActions({ ...ana, you: true }, [me, { ...ana, you: true }], "member")).toEqual(["leave"]);
  expect(memberActions({ ...me, you: false }, [{ ...me, you: false }, { ...ana, you: true }], "member")).toEqual([]);
});

test("invite link and email check", () => {
  expect(inviteUrl("https://app.example/", "/join/abc")).toBe("https://app.example/join/abc");
  expect(inviteMessage("Keluarga Demo", "https://x/join/1")).toMatch(/Keluarga Demo[\s\S]*https:\/\/x\/join\/1$/);
  expect(looksLikeEmail(" a@b.co ")).toBe(true);
  expect(looksLikeEmail("a@b")).toBe(false);
});
