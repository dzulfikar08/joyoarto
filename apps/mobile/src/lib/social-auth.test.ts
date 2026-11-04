import { expect, test } from "bun:test";

import { ApiError } from "./api";
import { exchangeIdToken, revokeSession, signInErrorMessage } from "./social-auth";

type Call = { url: string; init: RequestInit };

function fakeFetch(res: () => Response, calls: Call[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return res();
  };
}

test("posts the ID token and keeps the signed token from set-auth-token", async () => {
  const calls: Call[] = [];
  const out = await exchangeIdToken(
    { server: "https://s/", provider: "google", idToken: "gid" },
    fakeFetch(() => new Response(JSON.stringify({ token: "raw", user: { id: "u1" } }), { headers: { "set-auth-token": "raw.sig" } }), calls),
  );
  expect(out).toEqual({ token: "raw.sig", userId: "u1" });
  expect(calls[0]!.url).toBe("https://s/api/auth/sign-in/social");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ provider: "google", idToken: { token: "gid" } });
});

test("Apple sends the nonce and the first-time name", async () => {
  const calls: Call[] = [];
  await exchangeIdToken(
    { server: "https://s", provider: "apple", idToken: "aid", nonce: "n", name: { firstName: "Ani" } },
    fakeFetch(() => new Response(JSON.stringify({ token: "raw" })), calls),
  );
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ provider: "apple", idToken: { token: "aid", nonce: "n", user: { name: { firstName: "Ani" } } } });
});

test("errors carry a message to show", async () => {
  const invite = exchangeIdToken(
    { server: "https://s", provider: "google", idToken: "x" },
    fakeFetch(() => new Response(JSON.stringify({ code: "OAUTH_LINK_ERROR", message: "unable to create user" }), { status: 401 })),
  );
  await expect(invite).rejects.toThrow(/invite-only/);
  const offline = exchangeIdToken({ server: "https://s", provider: "google", idToken: "x" }, async () => {
    throw new TypeError("Network request failed");
  });
  await expect(offline).rejects.toBeInstanceOf(ApiError);
  expect(signInErrorMessage(401, "INVALID_TOKEN")).toMatch(/did not accept/);
  expect(signInErrorMessage(404, "PROVIDER_NOT_FOUND")).toMatch(/does not support/);
  expect(signInErrorMessage(401, "OAUTH_LINK_ERROR", "account not linked")).toMatch(/another sign-in/);
});

test("a success without any token is an error", async () => {
  await expect(exchangeIdToken({ server: "https://s", provider: "google", idToken: "x" }, fakeFetch(() => new Response("{}")))).rejects.toThrow(/no session/);
});

test("revokeSession is best effort", async () => {
  const calls: Call[] = [];
  expect(await revokeSession("https://s", "t.s", fakeFetch(() => new Response("{}"), calls))).toBe(true);
  expect(calls[0]!.url).toBe("https://s/api/auth/sign-out");
  expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t.s");
  expect(
    await revokeSession("https://s", "t", async () => {
      throw new Error("offline");
    }),
  ).toBe(false);
});
