// The phone app's sign-in: a session token in `Authorization: Bearer` (better-auth's bearer plugin), and the social
// providers that accept native ID tokens (Google's extra audiences, Sign in with Apple).

import { expect, test } from "bun:test";

import { schema } from "@baroka/db";

import { testDb } from "../../api/src/test/d1";
import { createAuth, parseList, socialProviders } from "./index";

const URL_BASE = "http://localhost:3000";
const env = { BETTER_AUTH_URL: URL_BASE, BETTER_AUTH_SECRET: "x".repeat(32), CORS_ORIGIN: URL_BASE };

test("parseList trims, drops empties and repeats", () => {
  expect(parseList(" a, b ,,a ")).toEqual(["a", "b"]);
  expect(parseList(undefined)).toEqual([]);
});

test("Google accepts the web client first, then the native client ids", () => {
  const p = socialProviders({ GOOGLE_CLIENT_ID: "web", GOOGLE_CLIENT_SECRET: "s", GOOGLE_NATIVE_CLIENT_IDS: "ios, web" });
  expect(p.google?.clientId).toEqual(["web", "ios"]);
  expect("apple" in p).toBe(false);
});

test("no Google secret, no Google; Apple only with bundle ids", () => {
  const p = socialProviders({ GOOGLE_CLIENT_ID: "web", APPLE_BUNDLE_IDS: "com.joyodigitama.joyoarto" });
  expect("google" in p).toBe(false);
  expect(p.apple?.audience).toEqual(["com.joyodigitama.joyoarto"]);
  expect(p.apple?.clientId).toBe("com.joyodigitama.joyoarto");
});

test("a session token works as a Bearer header, without cookies or Origin", async () => {
  const { db } = await testDb();
  await db.insert(schema.user).values({ id: "u1", name: "Phone User", email: "phone@example.com", emailVerified: true });
  const auth = createAuth(env, db, { demoSignIn: async () => ({ ok: true, userId: "u1" }) });
  // Any sign-in that sets the session cookie also answers set-auth-token (the demo endpoint stands in for Google here).
  const res = await auth.handler(
    new Request(`${URL_BASE}/api/auth/sign-in/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "c" }) }),
  );
  expect(res.status).toBe(200);
  const token = res.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  expect(res.headers.get("access-control-expose-headers") ?? "").toContain("set-auth-token");
  const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
  expect(session?.user.id).toBe("u1");
  // A forged or foreign token is no session.
  expect(await auth.api.getSession({ headers: new Headers({ authorization: "Bearer brk_notasession" }) })).toBeNull();
  expect(await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}x` }) })).toBeNull();
  // Sign-out with the bearer revokes it.
  const out = await auth.handler(new Request(`${URL_BASE}/api/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  expect(out.status).toBe(200);
  expect(await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })).toBeNull();
});
