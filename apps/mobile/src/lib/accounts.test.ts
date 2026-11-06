import { expect, test } from "bun:test";

import { accountFacts, accountFormErrors, accountSpan, createInput, EMPTY_ACCOUNT_FORM, formFromAccount, groupByType, idrTotal, institutionBadge, shortName, splitArchived, updateInput, type AccountRow } from "./accounts";

const acc = (p: Partial<AccountRow> = {}): AccountRow => ({
  id: "a1",
  name: "BCA Tahapan",
  institution: "bca",
  type: "bank",
  currency: "IDR",
  last4: "1234",
  archived: false,
  balance: { amount: 100_000_00, display: "Rp 100.000", currency: "IDR" },
  openingBalance: { amount: -1_250_000_00, display: "-Rp 1.250.000", currency: "IDR" },
  transactions: 1,
  firstDate: "2026-01-02",
  lastDate: "2026-10-31",
  lastPostedDate: "2026-10-31",
  pending: 0,
  ...p,
}) as AccountRow;

test("labels, facts and the archived split", () => {
  expect(accountFacts(acc())).toBe("BCA · Bank account · 1 transaction");
  expect(accountFacts(acc({ institution: "gopay", type: "ewallet", transactions: 3 }))).toBe("GoPay · E-wallet · 3 transactions");
  expect(accountSpan(acc())).toBe("2026-01-02 → 2026-10-31");
  expect(accountSpan(acc({ firstDate: null, lastDate: null }))).toBeNull();
  const { active, archived } = splitArchived([acc({ id: "x" }), acc({ id: "y", archived: true }), acc({ id: "z" })]);
  expect(active.map((a) => a.id)).toEqual(["x", "z"]);
  expect(archived.map((a) => a.id)).toEqual(["y"]);
});

test("the form round-trips an account and sends only changes", () => {
  const f = formFromAccount(acc());
  expect(f).toEqual({ name: "BCA Tahapan", institution: "bca", type: "bank", last4: "1234", opening: "-1.250.000" });
  expect(updateInput(acc(), f)).toBeNull();
  expect(updateInput(acc(), { ...f, name: " BCA Utama ", opening: "0" })).toEqual({ id: "a1", name: "BCA Utama", openingBalance: 0 });
  expect(updateInput(acc(), { ...f, type: "credit_card", last4: "" })).toEqual({ id: "a1", type: "credit_card", last4: "" });
});

test("create input and validation", () => {
  expect(createInput({ ...EMPTY_ACCOUNT_FORM, name: " Dompet ", institution: "cash", type: "cash", opening: "250.000" })).toEqual({
    name: "Dompet",
    institution: "cash",
    type: "cash",
    openingBalance: 25_000_000,
  });
  expect(createInput({ ...EMPTY_ACCOUNT_FORM, name: "BCA", last4: "9876" }).last4).toBe("9876");
  expect(accountFormErrors(EMPTY_ACCOUNT_FORM)?.name).toBeTruthy();
  expect(accountFormErrors({ ...EMPTY_ACCOUNT_FORM, name: "x", last4: "12ab", opening: "1,2,3" })).toEqual({ last4: "Up to 8 digits.", opening: expect.any(String) });
  expect(accountFormErrors({ ...EMPTY_ACCOUNT_FORM, name: "x" })).toBeNull();
});

test("short names drop the repeated institution prefix", () => {
  expect(shortName("Jago · Main Pocket", "jago")).toBe("Main Pocket");
  expect(shortName("jago · Tabungan", "jago")).toBe("Tabungan");
  expect(shortName("Jago · ", "jago")).toBe("Jago · ");
  expect(shortName("BCA Tahapan", "bca")).toBe("BCA Tahapan");
  expect(shortName("GoPay · Wallet", "bca")).toBe("GoPay · Wallet");
  expect(institutionBadge("bca")).toBe("BC");
  expect(institutionBadge("shopeepay")).toBe("SH");
  expect(institutionBadge("weird")).toBe("WE");
});

test("accounts grouped by type in display order, IDR totals", () => {
  const a = (type: string, amount: number, currency = "IDR") => ({ type, currency, balance: { amount } });
  const groups = groupByType([a("ewallet", 100), a("bank", 500), a("mystery", 7), a("bank", 200), a("credit_card", -300), a("bank", 999, "USD")]);
  expect(groups.map((g) => [g.type, g.label, g.items.length, g.total])).toEqual([
    ["bank", "Bank accounts", 3, 700],
    ["ewallet", "E-wallets", 1, 100],
    ["credit_card", "Credit cards", 1, -300],
    ["other", "Other", 1, 7],
  ]);
  expect(idrTotal([a("bank", 5), a("bank", 9, "USD"), a("loan", -2)])).toBe(3);
  expect(groupByType([])).toEqual([]);
});
