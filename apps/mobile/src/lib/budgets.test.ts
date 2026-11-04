import { expect, test } from "bun:test";

import { categoriesWithoutBudget, parseBudget } from "./budgets";

test("budget amounts", () => {
  expect(parseBudget("1.500.000")).toEqual({ amount: 150_000_000 });
  expect(parseBudget("Rp 750000")).toEqual({ amount: 75_000_000 });
  expect(parseBudget("")).toHaveProperty("error");
  expect(parseBudget("0")).toHaveProperty("error");
  expect(parseBudget("-5.000")).toHaveProperty("error");
  expect(parseBudget("1,2,3")).toHaveProperty("error");
});

test("categories that have no budget yet", () => {
  const opts = [{ value: "food/groceries" }, { value: "transport" }, { value: "food" }];
  expect(categoriesWithoutBudget(opts, ["food"]).map((o) => o.value)).toEqual(["food/groceries", "transport"]);
});
