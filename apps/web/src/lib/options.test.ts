/// <reference types="bun" />
import { expect, test } from "bun:test";

import { filterGroups, matchesOption } from "@baroka/ui/components/combobox";
import { normalizeItems } from "@baroka/ui/components/select";

import { accountOptions, categoryOptions } from "./options";

const CATS = [
  { slug: "food", name: "Food & drink", kind: "expense" },
  { slug: "food/groceries", name: "Groceries", kind: "expense" },
  { slug: "food/dining", name: "Eating out", kind: "expense" },
  { slug: "health", name: "Health", kind: "expense" },
  { slug: "income/salary", name: "Salary", kind: "income" },
  { slug: "income/refund", name: "Refunds & cashback", kind: "income" },
  { slug: "transfer/topup", name: "E-wallet top-up", kind: "transfer" },
  { slug: "giving", name: "Zakat, infaq & sedekah", kind: "expense" },
];

test("categories group under their parent; childless top levels group by kind", () => {
  const groups = categoryOptions(CATS);
  expect(groups.map((g) => g.label)).toEqual(["Food & drink", "Income", "Transfer", "Spending"]);
  expect(groups[0]!.options.map((o) => o.value)).toEqual(["food", "food/dining", "food/groceries"]);
  expect(groups[3]!.options.map((o) => o.label)).toEqual(["Zakat, infaq & sedekah", "Health"]);
});

test("search matches word starts of the label or the slug, ignoring case and accents", () => {
  const groups = normalizeItems(categoryOptions(CATS), "Uncategorized");
  const labels = (q: string) => filterGroups(groups, q).flatMap((g) => g.items.map((o) => o.label));
  expect(labels("dining")).toEqual(["Eating out"]);
  expect(labels("GRO")).toEqual(["Groceries"]);
  expect(labels("food out")).toEqual(["Eating out"]);
  expect(labels("uncat")).toEqual(["Uncategorized"]);
  expect(labels("")).toHaveLength(CATS.length + 1);
  expect(labels("xyz")).toEqual([]);
});

test("accounts match on name, last digits, institution and accents", () => {
  const [bca, cafe] = accountOptions([
    { id: "1", name: "BCA Tahapan", last4: "1234", institution: "bca", type: "bank" },
    { id: "2", name: "Café Ñandú", institution: "cash", type: "credit_card" },
  ]);
  expect(bca!.hint).toBe("··1234");
  expect(matchesOption(bca!, "1234")).toBe(true);
  expect(matchesOption(bca!, "tah")).toBe(true);
  expect(matchesOption(cafe!, "nandu")).toBe(true);
  expect(matchesOption(cafe!, "cafe credit")).toBe(true);
  expect(matchesOption(cafe!, "bca")).toBe(false);
});
