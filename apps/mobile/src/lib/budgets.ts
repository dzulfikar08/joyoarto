// Monthly category budgets (web: the Budgets card on routes/-dashboard.tsx; budgets.set, 0 removes). Pure, unit-tested.

import { rupiahInputToMinor } from "./format";

/** A monthly limit typed in rupiah: positive minor units, or an error to show. */
export function parseBudget(text: string): { amount: number } | { error: string } {
  if (!text.trim()) return { error: "Enter a monthly limit." };
  const v = rupiahInputToMinor(text);
  if (v === null) return { error: "Write it like 1.500.000." };
  if (v <= 0) return { error: "A budget is more than zero. Use Remove to drop it." };
  return { amount: v };
}

/** Which expense categories can get a new budget: those without one yet. */
export function categoriesWithoutBudget<T extends { value: string }>(options: readonly T[], budgeted: readonly string[]): T[] {
  const has = new Set(budgeted);
  return options.filter((o) => !has.has(o.value));
}
