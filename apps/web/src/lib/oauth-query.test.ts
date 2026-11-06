import { expect, test } from "bun:test";

import { grantedScopes, offersAccessChoice } from "./oauth-query";

const claude = ["finance:read", "finance:write", "offline_access"];

test("read-only drops finance:write and keeps offline_access", () => {
  expect(grantedScopes(claude, "read")).toBe("finance:read offline_access");
  expect(grantedScopes(claude, "write")).toBeUndefined();
});

test("no choice when the app only asked to read", () => {
  expect(offersAccessChoice(["finance:read", "offline_access"])).toBe(false);
  expect(grantedScopes(["finance:read", "offline_access"], "read")).toBeUndefined();
  expect(offersAccessChoice(["finance:write", "offline_access"])).toBe(false);
  expect(offersAccessChoice(claude)).toBe(true);
});
