import { expect, test } from "bun:test";

import { testAccount, testDb, testPrincipal } from "../test/d1";
import { importTransactions } from "./imports";
import type { ImportRow } from "./imports";
import { addMonths } from "../lib/plan/months";
import { baseline } from "./plan";
import { currentMonth } from "./reports";

test("plan baseline: the one-off is found even with more than 500 large expenses", async () => {
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const bca = await testAccount(db, p, "BCA");
  const now = new Date(Date.now() + 7 * 3600_000);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const rows: ImportRow[] = Array.from({ length: 520 }, (_, i) => ({
    date: `${month}-${String((i % 28) + 1).padStart(2, "0")}`,
    amount: -210_000_000,
    description: `Belanja ${i}`,
    category: "food/groceries",
  }));
  // Saved last, so an unordered capped query would drop it.
  rows.push({ date: `${month}-28`, amount: -50_000_000_000, description: "DP rumah", category: "food/groceries" });
  await importTransactions(db, p, { accountId: bca, rows, commit: true, source: "api", previewLimit: 0 });
  const b = await baseline(db, p, { months: 3 });
  expect(b.spending.excluded.some((e) => e.amount === 50_000_000_000)).toBe(true);
});

const rp = (rupiah: number) => rupiah * 100;

/** Salary, bills and groceries each month: a household that joined `months.length` months ago. */
function history(months: string[]): ImportRow[] {
  return months.flatMap((m) => [
    { date: `${m}-01`, amount: rp(15_000_000), description: "GAJI", category: "income/salary" },
    { date: `${m}-03`, amount: -rp(1_500_000), description: "PLN", category: "bills/electricity" },
    ...["08", "12", "18", "24"].map((d) => ({ date: `${m}-${d}`, amount: -rp(1_000_000), description: `BELANJA ${d}`, category: "food/groceries" })),
  ]);
}

async function household(months: string[]) {
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const acc = await testAccount(db, p, "BCA");
  if (months.length) await importTransactions(db, p, { accountId: acc, rows: history(months), commit: true, source: "api", previewLimit: 0 });
  return { db, p };
}

const last = (n: number) => Array.from({ length: n }, (_, i) => addMonths(currentMonth(), i - n));

test("plan baseline: 3 months of history in a 6-month window counts like a 3-month window", async () => {
  const { db, p } = await household(last(3));
  const six = await baseline(db, p, { months: 6 });
  const three = await baseline(db, p, { months: 3 });
  expect(six.months).toEqual(last(3));
  expect(six.history).toEqual({ monthsRequested: 6, monthsUsed: 3, firstMonth: last(3)[0]!, tooLittle: false });
  expect(six.income.recurring.amount).toBe(rp(15_000_000));
  expect(six.income.recurring.amount).toBe(three.income.recurring.amount);
  expect(six.income.median.amount).toBe(three.income.median.amount);
  expect(six.spending.monthly.amount).toBe(rp(5_500_000));
  expect(six.spending.monthly.amount).toBe(three.spending.monthly.amount);
  expect(six.existingInstallments.monthly.amount).toBe(three.existingInstallments.monthly.amount);
  expect(six.freeCash.amount).toBe(three.freeCash.amount);
  expect(six.notes.some((n) => n.includes("3 of the 6 requested months"))).toBe(true);
});

test("plan baseline: a first month that starts after the 7th is not a full month", async () => {
  const months = last(3);
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const acc = await testAccount(db, p, "BCA");
  const rows = history(months.slice(1));
  rows.push({ date: `${months[0]}-20`, amount: -rp(500_000), description: "BELANJA", category: "food/groceries" });
  await importTransactions(db, p, { accountId: acc, rows, commit: true, source: "api", previewLimit: 0 });
  const b = await baseline(db, p, { months: 6 });
  expect(b.months).toEqual(months.slice(1));
  expect(b.spending.monthly.amount).toBe(rp(5_500_000));
});

test("plan baseline: one month of history is used but flagged as too little", async () => {
  const { db, p } = await household(last(1));
  const b = await baseline(db, p, { months: 6 });
  expect(b.months).toEqual(last(1));
  expect(b.history.monthsUsed).toBe(1);
  expect(b.history.tooLittle).toBe(true);
  expect(b.income.recurring.amount).toBe(rp(15_000_000));
  expect(b.spending.monthly.amount).toBe(rp(5_500_000));
  expect(b.notes[0]).toContain("Only 1 complete month");
});

test("plan baseline: no history gives zeros and says so", async () => {
  const { db, p } = await household([]);
  const b = await baseline(db, p, { months: 6 });
  expect(b.months).toEqual([]);
  expect(b.history).toEqual({ monthsRequested: 6, monthsUsed: 0, firstMonth: null, tooLittle: true });
  expect(b.income.recurring.amount).toBe(0);
  expect(b.spending.monthly.amount).toBe(0);
  expect(b.existingInstallments.monthly.amount).toBe(0);
  expect(b.notes[0]).toContain("No complete month");
});
