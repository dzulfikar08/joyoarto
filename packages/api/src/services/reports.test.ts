import { expect, test } from "bun:test";

import { testAccount, testDb, testPrincipal } from "../test/d1";
import { importTransactions } from "./imports";
import { budgetStatus, setBudget } from "./reports";

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
