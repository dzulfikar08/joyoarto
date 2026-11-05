import { beforeEach, expect, test } from "bun:test";

import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { eq } from "drizzle-orm";

import type { Principal } from "../context";
import { sampleGopayText, sampleJagoText } from "../lib/statements/sample";
import { testDb, testPrincipal } from "../test/d1";
import { importStatement } from "./statements";

let db: Database;
let p: Principal;

beforeEach(async () => {
  ({ db } = await testDb());
  p = await testPrincipal(db);
});

test("GoPay: totals that do not add up save nothing", async () => {
  const text = sampleGopayText().replace(/(Total pengeluaran\nRp)([\d.]+)/, "$11");
  expect(text).not.toBe(sampleGopayText());
  const r = await importStatement(db, p, { text, commit: true });
  if (r.kind !== "gopay") throw new Error("expected gopay");
  expect(r.problems.length).toBeGreaterThan(0);
  expect(r.committed).toBe(false);
  expect(r.wallet.inserted).toBe(0);
  expect(await db.select().from(schema.paymentHint).where(eq(schema.paymentHint.householdId, p.householdId))).toEqual([]);
  expect(await db.select().from(schema.transaction).where(eq(schema.transaction.householdId, p.householdId))).toEqual([]);
});

test("GoPay: a verified statement is saved", async () => {
  const r = await importStatement(db, p, { text: sampleGopayText(), commit: true });
  if (r.kind !== "gopay") throw new Error("expected gopay");
  expect(r.problems).toEqual([]);
  expect(r.committed).toBe(true);
  expect((await db.select().from(schema.paymentHint).where(eq(schema.paymentHint.householdId, p.householdId))).length).toBeGreaterThan(0);
});

test("Jago: a statement whose balances do not add up saves no pocket", async () => {
  const text = sampleJagoText();
  const broken = text.replace(/-(\d{1,3}(?:\.\d{3})*,\d{2}) /, "-1$1 ");
  expect(broken).not.toBe(text);
  const r = await importStatement(db, p, { text: broken, commit: true });
  if (r.kind !== "jago") throw new Error("expected jago");
  expect(r.committed).toBe(false);
  expect(await db.select().from(schema.finAccount).where(eq(schema.finAccount.householdId, p.householdId))).toEqual([]);
});
