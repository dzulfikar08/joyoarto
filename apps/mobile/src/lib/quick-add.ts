// The add sheet's draft and how it becomes a quick add. Pure, unit-tested. Mirrors the web's add sheet
// (apps/web/src/components/add-sheet.tsx): the server's capture.parse returns a draft, the member reviews it, Save
// calls transactions.quickAdd (a pending row; the next statement import confirms it).

import { parseAmountText } from "@baroka/api/lib/amount-text";
import type { CaptureDraft } from "@baroka/api/lib/capture-parse";

import { amountInputText, todayWib } from "./format";

export type { CaptureDraft };

export type Review = {
  amountText: string;
  direction: "in" | "out";
  description: string;
  merchant: string;
  note: string;
  category: string;
  accountId: string;
  date: string;
  via: "voice" | "manual";
  heard: string | null;
  source: CaptureDraft["source"] | "hand";
};

export function emptyReview(accountId = "", today = todayWib()): Review {
  return { amountText: "", direction: "out", description: "", merchant: "", note: "", category: "", accountId, date: today, via: "manual", heard: null, source: "hand" };
}

export function reviewFromDraft(draft: CaptureDraft, via: Review["via"], heard: string | null, fallbackAccount = ""): Review {
  return {
    amountText: amountInputText(draft.amount),
    direction: draft.direction,
    description: draft.description,
    merchant: draft.merchant ?? "",
    note: draft.note ?? "",
    category: draft.category ?? "",
    accountId: draft.accountId ?? fallbackAccount,
    date: draft.date,
    via,
    heard,
    source: draft.source,
  };
}

/** The typed amount: null = nothing typed, "invalid" = unreadable. A leading sign is ignored (the toggle decides). */
export function parseReviewAmount(text: string, currency = "IDR"): { amount: number } | null | "invalid" {
  if (!text.trim()) return null;
  try {
    const parsed = parseAmountText(text.replace(/^[+-]\s*/, ""), currency);
    return parsed.amount > 0 ? { amount: parsed.amount } : "invalid";
  } catch {
    return "invalid";
  }
}

export type QuickAddPayload = {
  amount: number;
  description: string;
  merchant?: string;
  note?: string;
  accountId?: string;
  category?: string;
  occurredAt: string;
  capturedVia: "voice" | "manual";
  clientRef: string;
};

/** The quickAdd input for a reviewed draft, or a reason it can't be saved yet. */
export function quickAddPayload(review: Review, clientRef: string, currency = "IDR"): { ok: true; input: QuickAddPayload } | { ok: false; reason: string } {
  const parsed = parseReviewAmount(review.amountText, currency);
  if (parsed === null) return { ok: false, reason: "Type the amount." };
  if (parsed === "invalid") return { ok: false, reason: "Can't read that amount. Try 25rb, 25.000 or 1,5jt." };
  if (!review.description.trim()) return { ok: false, reason: "Say what it was." };
  return {
    ok: true,
    input: {
      amount: (review.direction === "in" ? 1 : -1) * parsed.amount,
      description: review.description.trim(),
      ...(review.merchant.trim() ? { merchant: review.merchant.trim() } : {}),
      ...(review.note.trim() ? { note: review.note.trim() } : {}),
      ...(review.accountId ? { accountId: review.accountId } : {}),
      ...(review.category ? { category: review.category } : {}),
      occurredAt: review.date,
      capturedVia: review.via,
      clientRef,
    },
  };
}
