import { expect, test } from "bun:test";

import { testAccount, testDb, testPrincipal } from "../test/d1";
import { importTransactions } from "./imports";
import type { ImportRow } from "./imports";
import { baseline } from "./plan";

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
