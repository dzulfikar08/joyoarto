// The operators' surface (docs/operator-access.md): every procedure behind adminProcedure is listed here, and none of
// them answers with member finance data. A new operator route fails the first test until it is added below, with a
// call in the second that proves it leaks nothing.

import { afterEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import { call } from "@orpc/server";

import type { Context } from "../context";
import { configureDataKey } from "../lib/data-key";
import { memoryFileStore } from "../services/attachments";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { appRouter } from "./index";
import { adminProcedure } from "./waitlist";

type Proc = { "~orpc": { route?: { path?: string }; middlewares: unknown[] } };

function operatorRoutes(): string[] {
  const guard = adminProcedure["~orpc"].middlewares.at(-1);
  const out: string[] = [];
  const walk = (node: Record<string, unknown>, path: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object" && "~orpc" in v) {
        if ((v as Proc)["~orpc"].middlewares.includes(guard)) out.push(`${[...path, k].join(".")} ${(v as Proc)["~orpc"].route?.path}`);
      } else if (v && typeof v === "object") walk(v as Record<string, unknown>, [...path, k]);
    }
  };
  walk(appRouter as unknown as Record<string, unknown>, []);
  return out.sort();
}

afterEach(() => configureDataKey(null));

test("the operator-only procedures are exactly these", () => {
  expect(operatorRoutes()).toEqual(["admin.encryptionBackfill /admin/encryption/backfill", "demo.reset /admin/demo/reset", "waitlist.list /waitlist"]);
});

test("no operator procedure answers with member finance data", async () => {
  configureDataKey(btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1))));
  const { db } = await testDb();
  const files = memoryFileStore();
  const member = await testPrincipal(db, "Member");
  const account = await testAccount(db, member, "BCA Tahapan 1234");
  const ctx = (p = member): Context => ({ db, principal: p, files });
  // A member's ledger with recognisable text everywhere.
  const tx = (await call(appRouter.transactions.add, { accountId: account, date: "2026-10-03", amount: -98_765_432, description: "SECRET-DESC-7731", merchant: "SECRET-MERCHANT", note: "SECRET-NOTE" }, { context: ctx() })).transaction;
  await call(appRouter.reimburse.profiles.create, { companyName: "SECRET-COMPANY", employeeId: "SECRET-NIK", currency: "IDR" }, { context: ctx() });
  await db.insert(schema.joyoConversation).values({ id: "c1", householdId: member.householdId, userId: member.userId, title: "SECRET-CHAT" });
  await db.insert(schema.waitlistSignup).values({ id: crypto.randomUUID(), email: "waiting@example.com", banks: ["jago"] });

  const operator = await testPrincipal(db, "Operator");
  const request = { ip: null, adminEmails: [`${operator.userId}@example.com`] };
  const as = { context: { ...ctx(operator), request } };
  const answers = [
    await call(appRouter.waitlist.list, {}, as),
    await call(appRouter.demo.reset, undefined, as),
    await call(appRouter.admin.encryptionBackfill, { limit: 200, files: 5 }, as),
  ];
  const text = JSON.stringify(answers);
  for (const s of ["SECRET", "98765432", "987.654", tx.id, account, member.householdId, "BCA Tahapan"]) expect(text).not.toContain(s);
});
