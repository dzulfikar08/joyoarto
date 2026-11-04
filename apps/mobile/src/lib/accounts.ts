// Accounts screen logic (web: apps/web/src/routes/accounts.tsx): institution and type labels, active and archived
// lists, the line under each account, and the add/edit form turned into accounts.create / accounts.update input.
// Pure, unit-tested.

import { amountInputText, plural, rupiahInputToMinor } from "./format";
import type { PickerOption } from "./options";
import type { AppRouterClient, In, Out } from "./rpc";

export type AccountRow = Out<AppRouterClient["accounts"]["list"]>["accounts"][number];
type CreateInput = In<AppRouterClient["accounts"]["create"]>;
type UpdateInput = In<AppRouterClient["accounts"]["update"]>;
export type Institution = NonNullable<CreateInput["institution"]>;
export type AccountType = CreateInput["type"];

// Same lists as the server's (services/accounts.ts INSTITUTIONS, db ACCOUNT_TYPES); the In<> types keep them in step.
export const INSTITUTIONS: readonly (readonly [Institution, string])[] = [
  ["bca", "BCA"],
  ["mandiri", "Mandiri"],
  ["jago", "Jago"],
  ["jenius", "Jenius"],
  ["bni", "BNI"],
  ["bri", "BRI"],
  ["gopay", "GoPay"],
  ["ovo", "OVO"],
  ["dana", "DANA"],
  ["shopeepay", "ShopeePay"],
  ["cash", "Cash"],
  ["other", "Other"],
];

export const ACCOUNT_TYPES: readonly (readonly [AccountType, string])[] = [
  ["bank", "Bank account"],
  ["credit_card", "Credit card"],
  ["ewallet", "E-wallet"],
  ["cash", "Cash"],
  ["investment", "Investment"],
  ["loan", "Loan"],
  ["other", "Other"],
];

export const INSTITUTION_OPTIONS: PickerOption[] = INSTITUTIONS.map(([value, label]) => ({ value, label }));
export const TYPE_OPTIONS: PickerOption[] = ACCOUNT_TYPES.map(([value, label]) => ({ value, label }));

const instLabel = new Map<string, string>(INSTITUTIONS);
const typeLabel = new Map<string, string>(ACCOUNT_TYPES);

export const institutionLabel = (v: string) => instLabel.get(v) ?? v;
export const accountTypeLabel = (v: string) => typeLabel.get(v) ?? v;

/** Open accounts first (as the server orders them), archived ones apart for a collapsed section. */
export function splitArchived<T extends { archived: boolean }>(list: readonly T[]): { active: T[]; archived: T[] } {
  return { active: list.filter((a) => !a.archived), archived: list.filter((a) => a.archived) };
}

/** "BCA · Bank account · 12 transactions". */
export function accountFacts(a: Pick<AccountRow, "institution" | "type" | "transactions">): string {
  return [institutionLabel(a.institution), accountTypeLabel(a.type), plural(a.transactions, "transaction")].join(" · ");
}

/** "2026-01-02 → 2026-10-31", or null before the first transaction. */
export function accountSpan(a: Pick<AccountRow, "firstDate" | "lastDate">): string | null {
  return a.firstDate ? `${a.firstDate} → ${a.lastDate ?? a.firstDate}` : null;
}

export type AccountForm = { name: string; institution: Institution; type: AccountType; last4: string; opening: string };

export const EMPTY_ACCOUNT_FORM: AccountForm = { name: "", institution: "bca", type: "bank", last4: "", opening: "" };

export function formFromAccount(a: AccountRow): AccountForm {
  return {
    name: a.name,
    institution: (instLabel.has(a.institution) ? a.institution : "other") as Institution,
    type: (typeLabel.has(a.type) ? a.type : "other") as AccountType,
    last4: a.last4 ?? "",
    opening: a.openingBalance.amount ? `${a.openingBalance.amount < 0 ? "-" : ""}${amountInputText(a.openingBalance.amount, a.currency)}` : "",
  };
}

/** What is wrong with the form (shown under the field), or null. */
export function accountFormErrors(f: AccountForm): { name?: string; last4?: string; opening?: string } | null {
  const e: { name?: string; last4?: string; opening?: string } = {};
  if (!f.name.trim()) e.name = "Give the account a name.";
  else if (f.name.trim().length > 80) e.name = "At most 80 characters.";
  if (f.last4.trim() && !/^\d{1,8}$/.test(f.last4.trim())) e.last4 = "Up to 8 digits.";
  if (rupiahInputToMinor(f.opening) === null) e.opening = "Write it like 1.250.000 (a minus for a debt).";
  return Object.keys(e).length ? e : null;
}

export function createInput(f: AccountForm): CreateInput {
  const last4 = f.last4.trim();
  return { name: f.name.trim(), institution: f.institution, type: f.type, ...(last4 ? { last4 } : {}), openingBalance: rupiahInputToMinor(f.opening) ?? 0 };
}

/** Only what changed, so an edit never resets anything else. Null when nothing changed. */
export function updateInput(a: AccountRow, f: AccountForm): UpdateInput | null {
  const patch: UpdateInput = { id: a.id };
  if (f.name.trim() !== a.name) patch.name = f.name.trim();
  if (f.institution !== a.institution) patch.institution = f.institution;
  if (f.type !== a.type) patch.type = f.type;
  if (f.last4.trim() !== (a.last4 ?? "")) patch.last4 = f.last4.trim();
  const opening = rupiahInputToMinor(f.opening) ?? a.openingBalance.amount;
  if (opening !== a.openingBalance.amount) patch.openingBalance = opening;
  return Object.keys(patch).length > 1 ? patch : null;
}
