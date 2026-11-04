import { expect, test } from "bun:test";

import { accountOptions, categoryOptions, filterOptions, findOption, optionCount } from "./options";

const cats = [
  { slug: "food", name: "Food", kind: "expense" },
  { slug: "food/groceries", name: "Groceries", kind: "expense" },
  { slug: "food/coffee", name: "Coffee & café", kind: "expense" },
  { slug: "salary", name: "Salary", kind: "income" },
  { slug: "transfer/own", name: "Own accounts", kind: "transfer" },
  { slug: "health", name: "Health", kind: "expense" },
];

test("categories group by parent, then loose ones by kind", () => {
  const groups = categoryOptions(cats);
  expect(groups.map((g) => g.label)).toEqual(["Food", "Transfer", "Spending", "Income"]);
  expect(groups[0]!.options.map((o) => o.value)).toEqual(["food", "food/coffee", "food/groceries"]);
  expect(optionCount(groups)).toBe(cats.length);
});

test("search matches label, slug and group, ignoring accents and case", () => {
  const groups = categoryOptions(cats);
  expect(filterOptions(groups, "cafe").flatMap((g) => g.options.map((o) => o.value))).toEqual(["food/coffee"]);
  expect(filterOptions(groups, "GROC").flatMap((g) => g.options.map((o) => o.value))).toEqual(["food/groceries"]);
  expect(filterOptions(groups, "food coffee").flatMap((g) => g.options.map((o) => o.value))).toEqual(["food/coffee"]);
  expect(filterOptions(groups, "zzz")).toEqual([]);
  expect(findOption(groups, "salary")?.label).toBe("Salary");
  expect(findOption(groups, null)).toBeUndefined();
});

test("accounts: last digits as hint, archived hidden", () => {
  const groups = accountOptions([
    { id: "a", name: "Jago Main", last4: "1234", institution: "Jago", type: "bank" },
    { id: "b", name: "Old", archived: true },
  ]);
  expect(groups[0]!.options).toEqual([{ value: "a", label: "Jago Main", hint: "Jago ··1234", keywords: "Jago bank" }]);
  expect(optionCount(accountOptions([{ id: "b", name: "Old", archived: true }], true))).toBe(1);
});
