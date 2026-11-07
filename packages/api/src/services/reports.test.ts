import { expect, test } from "bun:test";

import { testAccount, testDb, testPrincipal } from "../test/d1";
import { importTransactions } from "./imports";
import { budgetStatus, moneyFlow, setBudget } from "./reports";

test("budget totals count a child budget once, inside its parent's", async () => {
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const bca = await testAccount(db, p, "BCA");
  const month = "2026-10";
  await importTransactions(db, p, {
    accountId: bca,
    rows: [
      { date: "2026-10-03", amount: -30_000_000, description: "Superindo", category: "food/groceries" },
      { date: "2026-10-04", amount: -20_000_000, description: "Warung", category: "food/dining" },
      { date: "2026-10-05", amount: -10_000_000, description: "Grab", category: "transport" },
    ],
    commit: true,
    source: "api",
    previewLimit: 0,
  });
  await setBudget(db, p, { category: "food", amount: 100_000_000 });
  await setBudget(db, p, { category: "food/groceries", amount: 40_000_000 });
  await setBudget(db, p, { category: "transport", amount: 50_000_000 });
  const s = await budgetStatus(db, p, { month });
  expect(s.budgets.find((b) => b.category === "food")!.spent.amount).toBe(50_000_000);
  expect(s.budgets.find((b) => b.category === "food/groceries")!.spent.amount).toBe(30_000_000);
  // food (Rp 1 jt budget, Rp 500rb spent) + transport (Rp 500rb, Rp 100rb); groceries is inside food.
  expect(s.total).toEqual({ budget: "Rp 1.500.000", spent: "Rp 600.000" });
});

test("money flow: income in, spending groups and saved out, transfers left out", async () => {
  const { db } = await testDb();
  const p = await testPrincipal(db);
  const bca = await testAccount(db, p, "BCA");
  await importTransactions(db, p, {
    accountId: bca,
    rows: [
      { date: "2026-10-01", amount: 1_000_000_000, description: "Gaji", category: "income/salary" },
      { date: "2026-10-03", amount: -30_000_000, description: "Superindo", category: "food/groceries" },
      { date: "2026-10-04", amount: -20_000_000, description: "Warung", category: "food/dining" },
      { date: "2026-10-05", amount: -400_000_000, description: "Sewa", category: "home" },
      { date: "2026-10-06", amount: -100_000_000, description: "Top up GoPay", category: "transfer/topup" },
      { date: "2026-11-01", amount: -5_000_000, description: "Next month", category: "home" },
    ],
    commit: true,
    source: "api",
    previewLimit: 0,
  });
  const f = await moneyFlow(db, p, { month: "2026-10" });
  expect(f.income.amount).toBe(1_000_000_000);
  expect(f.spending.amount).toBe(450_000_000);
  expect(f.saved.amount).toBe(550_000_000);
  expect(f.nodes.map((n) => [n.id, n.label, n.amount])).toEqual([
    ["source:income/salary", "Salary", 1_000_000_000],
    ["hub", "Money in", 1_000_000_000],
    ["group:home", "Home & rent", 400_000_000],
    ["group:food", "Food & drink", 50_000_000],
    ["item:food/groceries", "Groceries", 30_000_000],
    ["item:food/dining", "Eating out", 20_000_000],
    ["saved", "Saved", 550_000_000],
  ]);
});
