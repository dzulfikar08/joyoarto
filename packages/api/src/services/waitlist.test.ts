import { beforeEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";

import { appRouter } from "../routers/index";
import { testDb, testPrincipal } from "../test/d1";
import { listWaitlist } from "./waitlist";

let db: Database;

beforeEach(async () => {
  ({ db } = await testDb());
});

// Nobody can join any more; these rows stand for the sign-ups kept from before open sign-up.
const add = (email: string, banks: string[] = []) => db.insert(schema.waitlistSignup).values({ id: crypto.randomUUID(), email, banks });

test("list counts sign-ups and banks", async () => {
  await add("a@b.co", ["jago", "bca"]);
  await add("c@d.co", ["jago"]);
  await add("e@f.co");
  const r = await listWaitlist(db, { limit: 2, offset: 0 });
  expect(r.count).toBe(3);
  expect(r.signups).toHaveLength(2);
  expect(r.banks).toEqual([
    { bank: "jago", count: 2 },
    { bank: "bca", count: 1 },
  ]);
});

test("there is no public join procedure", () => {
  expect("join" in appRouter.waitlist).toBe(false);
});

test("list only for operators, on a browser session", async () => {
  await add("a@b.co");
  const base = { ip: "203.0.113.7", adminEmails: ["boss@example.com"] };
  const p = await testPrincipal(db);
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: p, request: base } })).rejects.toThrow(/operators/);
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: null, request: base } })).rejects.toThrow();
  const boss = { ...base, adminEmails: [`${p.userId}@example.com`] };
  expect((await call(appRouter.waitlist.list, {}, { context: { db, principal: p, request: boss } })).count).toBe(1);
  // A token is not enough, even for an operator.
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: { ...p, via: "token" }, request: boss } })).rejects.toThrow();
});
