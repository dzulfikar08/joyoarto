import { normalizeText } from "./merchant";

export type RuleLike = {
  id: string;
  priority: number;
  field: "merchant" | "description";
  match: "contains" | "equals" | "starts_with";
  pattern: string;
  accountId: string | null;
  direction: "in" | "out" | null;
  minAmount: number | null;
  maxAmount: number | null;
  setCategoryId: string | null;
  setMerchant: string | null;
  enabled: boolean;
};

export type RuleTarget = { accountId: string; amount: number; description: string; merchant: string | null };

export function ruleMatches(rule: RuleLike, tx: RuleTarget): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== tx.accountId) return false;
  if (rule.direction === "in" && tx.amount < 0) return false;
  if (rule.direction === "out" && tx.amount >= 0) return false;
  const abs = Math.abs(tx.amount);
  if (rule.minAmount !== null && abs < rule.minAmount) return false;
  if (rule.maxAmount !== null && abs > rule.maxAmount) return false;
  const subject = normalizeText((rule.field === "merchant" ? tx.merchant : tx.description) ?? "");
  const pattern = normalizeText(rule.pattern);
  if (!pattern) return false;
  switch (rule.match) {
    case "equals":
      return subject === pattern;
    case "starts_with":
      return subject.startsWith(pattern);
    case "contains":
      return subject.includes(pattern);
  }
}

/** The first matching rule by priority (then age, which the caller's order gives), or null. */
export function firstMatch<R extends RuleLike>(rules: readonly R[], tx: RuleTarget): R | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  return ordered.find((rule) => ruleMatches(rule, tx)) ?? null;
}

/** What a rule does to a transaction: a merchant rename first, then the category. */
export function applyRule(rule: RuleLike | null, tx: RuleTarget) {
  if (!rule) return { merchant: tx.merchant, categoryId: null as string | null, ruleId: null as string | null };
  return { merchant: rule.setMerchant ?? tx.merchant, categoryId: rule.setCategoryId, ruleId: rule.id };
}
