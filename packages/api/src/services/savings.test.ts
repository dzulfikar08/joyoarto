import { expect, test } from "bun:test";

import { schema } from "@baroka/db";
import { and, eq, like } from "drizzle-orm";

import { addMonths } from "../lib/plan/months";
import { testAccount, testDb, testPrincipal } from "../test/d1";
import { importTransactions } from "./imports";
import type { ImportRow } from "./imports";
import { currentMonth } from "./reports";
import { savings } from "./savings";

const rp = (rupiah: number) => rupiah * 100;

/** Three complete months before this one, three coffees a week each, and a salary. */
function ledger(merchant: string, months: string[]): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const m of months) {
    rows.push({ date: `${m}-01`, amount: rp(15_000_000), description: "GAJI", category: "income/salary" });
    for (const d of [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27]) {
      rows.push({ date: `${m}-${String(d).padStart(2, "0")}`, amount: -rp(30_000), description: `QRIS ${merchant} ${d}`, merchant, category: "food/coffee" });
    }
  }
  return rows;
}

test("spending cuts: only the household's own rows; transfers and reimbursable expenses left out", async () => {
  const { db } = await testDb();
  const dewi = await testPrincipal(db, "Dewi");
  const other = await testPrincipal(db, "Other");
  const bca = await testAccount(db, dewi, "BCA");
  const otherAcc = await testAccount(db, other, "BCA");
  const cur = currentMonth();
  const months = [addMonths(cur, -3), addMonths(cur, -2), addMonths(cur, -1)];

  const mine = ledger("Kopi Kenangan", months);
  // A coffee for a client, marked reimbursable below, and a top-up at Indomaret (a transfer).
  mine.push({ date: `${months[1]}-14`, amount: -rp(400_000), description: "KOPI CLIENT MEETING", merchant: "Kopi Kenangan", category: "food/coffee" });
  mine.push({ date: `${months[1]}-15`, amount: -rp(50_000), description: "TOPUP INDOMARET", merchant: "Indomaret", category: "transfer/topup" });
  // Snack runs at the minimarket, categorised as groceries.
  for (const m of months) for (const d of ["03", "10", "17", "24"]) mine.push({ date: `${m}-${d}`, amount: -rp(22_000), description: "QRIS INDOMARET", merchant: "Indomaret", category: "food/groceries" });
  await importTransactions(db, dewi, { accountId: bca, rows: mine, commit: true, source: "api", previewLimit: 0 });
  // The other household drinks far more coffee; none of it may show up.
  await importTransactions(db, other, { accountId: otherAcc, rows: [...ledger("Starbucks", months), ...ledger("Starbucks", months).map((r) => ({ ...r, description: `${r.description} B` }))], commit: true, source: "api", previewLimit: 0 });
  await db
    .update(schema.transaction)
    .set({ reimburseStatus: "submitted" })
    .where(and(eq(schema.transaction.householdId, dewi.householdId), like(schema.transaction.description, "KOPI CLIENT%")));

  const r = await savings(db, dewi, { horizonMonths: 36, effect: true } as never);
  expect(r.months).toEqual(months);
  const coffee = r.habits.find((h) => h.key === "food/coffee")!;
  expect(coffee.count).toBe(36);
  expect(coffee.monthly.amount).toBe(rp(360_000));
  expect(coffee.topMerchants.map((x) => x.name)).toEqual(["Kopi Kenangan"]);
  expect(coffee.suggestion?.unit).toBe("week");
  expect(coffee.incomeSharePct).toBe(2.4);
  const mini = r.habits.find((h) => h.key === "minimarket")!;
  expect(mini.count).toBe(12);
  expect(r.cutItems.map((c) => c.id)).toContain("cut:food/coffee");
  expect(r.effect!.monthlySaving.amount).toBe(r.totalSaving.amount);
  expect(r.effect!.milestones[0]!.id).toBe("emergency");

  // Chosen targets change the saving.
  const less = await savings(db, dewi, { targets: { "food/coffee": 0 }, effect: false } as never);
  expect(less.habits.find((h) => h.key === "food/coffee")!.suggestion!.saving.amount).toBe(rp(360_000));
  expect(less.effect).toBeNull();

  const theirs = await savings(db, other, { effect: false } as never);
  expect(theirs.habits.find((h) => h.key === "food/coffee")!.count).toBe(72);
});

test("spending cuts: a new household gets no suggestions and says why", async () => {
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const acc = await testAccount(db, p);
  const last = addMonths(currentMonth(), -1);
  await importTransactions(db, p, { accountId: acc, rows: ledger("Fore", [last]), commit: true, source: "api", previewLimit: 0 });
  const r = await savings(db, p, { effect: false } as never);
  expect(r.months).toEqual([last]);
  expect(r.habits[0]!.suggestion).toBeNull();
  expect(r.habits[0]!.reason).toContain("1 complete month");
  expect(r.totalSaving.amount).toBe(0);
});
