import { beforeEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { call } from "@orpc/server";

import type { Context } from "../context";
import { appRouter } from "../routers/index";
import { testDb, testPrincipal } from "../test/d1";
import { hashIp, joinInput, joinWaitlist, listWaitlist } from "./waitlist";

let db: Database;

beforeEach(async () => {
  ({ db } = await testDb());
});

const join = (input: Record<string, unknown>, ipHash: string | null = null) => joinWaitlist(db, joinInput.parse(input), ipHash);
const rows = () => db.select().from(schema.waitlistSignup);

test("validation: email is trimmed and lowercased, bad input is rejected", () => {
  expect(joinInput.parse({ email: "  Dewi@Example.COM " }).email).toBe("dewi@example.com");
  expect(joinInput.parse({ email: "a@b.co", banks: [" Jago ", "BCA"] }).banks).toEqual(["jago", "bca"]);
  expect(joinInput.safeParse({ email: "not-an-email" }).success).toBe(false);
  expect(joinInput.safeParse({ email: `${"x".repeat(250)}@example.com` }).success).toBe(false);
  expect(joinInput.safeParse({ email: "a@b.co", banks: Array(13).fill("bca") }).success).toBe(false);
  expect(joinInput.safeParse({ email: "a@b.co", banks: ["<script>"] }).success).toBe(false);
  expect(joinInput.safeParse({ email: "a@b.co", locale: "fr" }).success).toBe(false);
  expect(joinInput.safeParse({ email: "a@b.co", utm: { evil: "x" } }).success).toBe(false);
  expect(joinInput.safeParse({ email: "a@b.co", utm: { utm_source: "x" } }).success).toBe(true);
});

test("join stores one row per email and is idempotent", async () => {
  const first = await join({ email: "Dewi@Example.com", name: "Dewi", banks: ["jago", "gopay", "jago"], source: "demo", locale: "id" }, "h1");
  const again = await join({ email: "dewi@example.com ", banks: ["bca"] });
  // Same answer either way, so the endpoint cannot tell whether an address is already on the list.
  expect(again).toEqual(first);
  const all = await rows();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ email: "dewi@example.com", name: "Dewi", banks: ["jago", "gopay"], source: "demo", locale: "id", ipHash: "h1" });
});

test("utm_source is the source when none is given", async () => {
  await join({ email: "a@b.co", utm: { utm_source: "threads", utm_campaign: "launch" } });
  expect((await rows())[0]).toMatchObject({ source: "threads", utm: { utm_source: "threads", utm_campaign: "launch" } });
});

test("honeypot: answered like a success, nothing stored", async () => {
  const r = await join({ email: "bot@spam.example", website: "http://spam.example" });
  expect(r.ok).toBe(true);
  expect(await rows()).toHaveLength(0);
});

test("list counts sign-ups and banks", async () => {
  await join({ email: "a@b.co", banks: ["jago", "bca"] });
  await join({ email: "c@d.co", banks: ["jago"] });
  await join({ email: "e@f.co" });
  const r = await listWaitlist(db, { limit: 2, offset: 0 });
  expect(r.count).toBe(3);
  expect(r.signups).toHaveLength(2);
  expect(r.banks).toEqual([
    { bank: "jago", count: 2 },
    { bank: "bca", count: 1 },
  ]);
});

test("ip hash depends on the salt and never contains the ip", async () => {
  const a = await hashIp("203.0.113.7", "s1");
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(await hashIp("203.0.113.7", "s2"));
});

test("procedures: rate limit on join, list only for operators", async () => {
  const base = { ip: "203.0.113.7", ipSalt: "salt", adminEmails: ["boss@example.com"] };
  const blocked: Context = { db, principal: null, request: { ...base, allow: async () => false } };
  await expect(call(appRouter.waitlist.join, { email: "a@b.co" }, { context: blocked })).rejects.toThrow(/Terlalu banyak/);
  const open: Context = { db, principal: null, request: { ...base, allow: async () => true } };
  await call(appRouter.waitlist.join, { email: "a@b.co" }, { context: open });
  expect((await rows())[0]!.ipHash).toBe(await hashIp("203.0.113.7", "salt"));

  const p = await testPrincipal(db);
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: p, request: base } })).rejects.toThrow(/operators/);
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: null, request: base } })).rejects.toThrow();
  const boss = { ...base, adminEmails: [`${p.userId}@example.com`] };
  expect((await call(appRouter.waitlist.list, {}, { context: { db, principal: p, request: boss } })).count).toBe(1);
  // A token is not enough, even for an operator.
  await expect(call(appRouter.waitlist.list, {}, { context: { db, principal: { ...p, via: "token" }, request: boss } })).rejects.toThrow();
});
