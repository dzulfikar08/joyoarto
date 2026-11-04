import { expect, test } from "bun:test";

import { firstMatch } from "./rules";
import type { RuleLike } from "./rules";

const base: RuleLike = {
  id: "r",
  priority: 100,
  field: "merchant",
  match: "contains",
  pattern: "indomaret",
  accountId: null,
  direction: null,
  minAmount: null,
  maxAmount: null,
  setCategoryId: "groceries",
  setMerchant: null,
  enabled: true,
};
const tx = { accountId: "a", amount: -2500000, description: "KARTU DEBIT INDOMARET", merchant: "Indomaret" };

test("priority, direction and amount bounds", () => {
  const big = { ...base, id: "big", priority: 10, minAmount: 100_000_00, setCategoryId: "bulk" };
  expect(firstMatch([base, big], tx)?.id).toBe("r");
  expect(firstMatch([base, big], { ...tx, amount: -200_000_00 })?.id).toBe("big");
  expect(firstMatch([{ ...base, direction: "in" }], tx)).toBeNull();
  expect(firstMatch([{ ...base, enabled: false }], tx)).toBeNull();
  expect(firstMatch([{ ...base, field: "description", match: "starts_with", pattern: "kartu debit" }], tx)?.id).toBe("r");
});
