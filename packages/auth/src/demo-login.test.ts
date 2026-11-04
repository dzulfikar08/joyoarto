// POST /api/auth/sign-in/demo: the web app's demo sign-in (the code check and seeding live in packages/api's services/demo.ts).

import { expect, test } from "bun:test";

import { schema } from "@baroka/db";

import { testDb } from "../../api/src/test/d1";
import { createAuth } from "./index";
import type { AuthHooks } from "./index";

const URL_BASE = "http://localhost:3000";
const env = { BETTER_AUTH_URL: URL_BASE, BETTER_AUTH_SECRET: "x".repeat(32), CORS_ORIGIN: URL_BASE };

async function setup(demoSignIn?: AuthHooks["demoSignIn"]) {
  const { db } = await testDb();
  await db.insert(schema.user).values({ id: "demo-reviewer", name: "Demo Reviewer", email: "reviewer@demo.joyoarto.invalid", emailVerified: true });
  return createAuth(env, db, { demoSignIn });
}

const post = (auth: Awaited<ReturnType<typeof setup>>, body: unknown) =>
  auth.handler(new Request(`${URL_BASE}/api/auth/sign-in/demo`, { method: "POST", headers: { "Content-Type": "application/json", Origin: URL_BASE }, body: JSON.stringify(body) }));

test("no hook, no endpoint", async () => {
  const res = await post(await setup(), { code: "x" });
  expect(res.status).toBe(404);
});

test("off, wrong code, missing code", async () => {
  expect((await post(await setup(async () => ({ ok: false, reason: "off" })), { code: "x" })).status).toBe(404);
  expect((await post(await setup(async () => ({ ok: false, reason: "wrong" })), { code: "x" })).status).toBe(401);
  expect((await post(await setup(async () => ({ ok: true, userId: "demo-reviewer" })), {})).status).toBe(400);
});

test("the right code gives a session cookie for the demo user", async () => {
  const seen: string[] = [];
  const auth = await setup(async (code) => {
    seen.push(code);
    return { ok: true, userId: "demo-reviewer" };
  });
  const res = await post(auth, { code: "review" });
  expect(res.status).toBe(200);
  expect(seen).toEqual(["review"]);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("better-auth.session_token=");
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(";")[0]! }) });
  expect(session?.user.id).toBe("demo-reviewer");
});
