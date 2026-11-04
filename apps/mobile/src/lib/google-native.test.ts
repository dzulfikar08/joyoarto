import { expect, test } from "bun:test";

import { classifyNativeGoogleError, GOOGLE_UNAVAILABLE_MESSAGE, signInWithNativeGoogle, type NativeGoogleToken } from "./google-native";

const codes = { SIGN_IN_CANCELLED: "-5", PLAY_SERVICES_NOT_AVAILABLE: "-1" };

test("classifies native errors", () => {
  expect(classifyNativeGoogleError({ code: "-5" }, codes)).toEqual({ status: "cancelled" });
  expect(classifyNativeGoogleError({ code: 10, message: "x" }, codes).status).toBe("unavailable");
  expect(classifyNativeGoogleError({ code: "-1" }, codes).status).toBe("unavailable");
  expect(classifyNativeGoogleError(new Error("boom"), codes).status).toBe("failed");
});

function deps(token: NativeGoogleToken, opts: { available?: boolean; exchange?: (t: string) => Promise<void> } = {}) {
  const exchanged: string[] = [];
  return {
    exchanged,
    deps: {
      available: () => opts.available ?? true,
      requestIdToken: async () => token,
      exchange: opts.exchange ?? (async (t: string) => void exchanged.push(t)),
    },
  };
}

test("signs in with the token", async () => {
  const d = deps({ status: "ok", idToken: "gid" });
  expect(await signInWithNativeGoogle(d.deps)).toEqual({ kind: "signed-in" });
  expect(d.exchanged).toEqual(["gid"]);
});

test("not configured or not registered: unavailable, with the token hint", async () => {
  expect(await signInWithNativeGoogle(deps({ status: "ok", idToken: "x" }, { available: false }).deps)).toEqual({ kind: "unavailable", message: GOOGLE_UNAVAILABLE_MESSAGE });
  expect((await signInWithNativeGoogle(deps({ status: "unavailable", reason: "developer error" }).deps)).kind).toBe("unavailable");
});

test("cancel is quiet; failures carry a message", async () => {
  expect(await signInWithNativeGoogle(deps({ status: "cancelled" }).deps)).toEqual({ kind: "cancelled" });
  expect((await signInWithNativeGoogle(deps({ status: "failed", reason: "x" }).deps)).kind).toBe("failed");
  const rejected = await signInWithNativeGoogle(
    deps({ status: "ok", idToken: "x" }, {
      exchange: async () => {
        throw new Error("invite-only");
      },
    }).deps,
  );
  expect(rejected).toEqual({ kind: "failed", message: "invite-only" });
});
