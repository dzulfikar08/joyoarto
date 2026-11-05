import { expect, test } from "bun:test";

import { emptyReview, parseReviewAmount, quickAddPayload, reviewFromDraft } from "./quick-add";

test("a draft from the parser becomes an editable review", () => {
  const r = reviewFromDraft(
    { amount: 2500000, direction: "out", merchant: "Kopi Kenangan", description: "Kopi Kenangan", note: null, category: "food/coffee", accountId: null, date: "2026-11-04", source: "ai" },
    "manual",
    null,
    "acc1",
  );
  expect(r.amountText).toBe("25.000");
  expect(r.accountId).toBe("acc1");
  expect(r.category).toBe("food/coffee");
});

test("amounts", () => {
  expect(parseReviewAmount("")).toBeNull();
  expect(parseReviewAmount("25rb")).toEqual({ amount: 2500000 });
  expect(parseReviewAmount("-1,5jt")).toEqual({ amount: 150000000 });
  expect(parseReviewAmount("abc")).toBe("invalid");
});

test("payload: sign from the toggle, optional fields left out", () => {
  const review = { ...emptyReview("", "2026-11-04"), amountText: "16 juta", direction: "in" as const, description: " Gaji " };
  expect(quickAddPayload(review, "ref1")).toEqual({
    ok: true,
    input: { amount: 1600000000, description: "Gaji", occurredAt: "2026-11-04", capturedVia: "manual", clientRef: "ref1" },
  });
  const out = quickAddPayload({ ...review, direction: "out", accountId: "a", category: "c", merchant: "m", note: "n" }, "r");
  expect(out.ok && out.input).toMatchObject({ amount: -1600000000, accountId: "a", category: "c", merchant: "m", note: "n" });
});

test("payload refuses what can't be saved", () => {
  expect(quickAddPayload(emptyReview(), "r")).toEqual({ ok: false, reason: "Type the amount." });
  expect(quickAddPayload({ ...emptyReview(), amountText: "x" }, "r").ok).toBe(false);
  expect(quickAddPayload({ ...emptyReview(), amountText: "5rb" }, "r")).toEqual({ ok: false, reason: "Say what it was." });
});

test("receipt: the photo is attached and reimbursement sent only for money out", () => {
  const r = reviewFromDraft(
    { amount: 8750000, direction: "out", merchant: "Bakmi GM", description: "Makan siang tim", note: "Rincian: Bakmi ayam Rp 45.000", category: "food/dining", accountId: "gopay", date: "2026-11-04", source: "ai" },
    "receipt",
    null,
    "acc1",
    { photo: { id: "att1", uri: "file:///struk.jpg" }, reimburse: { on: true, profileId: "" } },
  );
  const p = quickAddPayload(r, "ref1");
  expect(p.ok && p.input).toMatchObject({ amount: -8750000, capturedVia: "receipt", attachmentIds: ["att1"], reimbursable: true, accountId: "gopay" });
  expect(p.ok && "reimburseProfileId" in p.input).toBe(false);
  const picked = quickAddPayload({ ...r, reimburse: { on: true, profileId: "pt1" } }, "ref1");
  expect(picked.ok && picked.input.reimburseProfileId).toBe("pt1");
  const income = quickAddPayload({ ...r, direction: "in" }, "ref1");
  expect(income.ok && "reimbursable" in income.input).toBe(false);
  expect(emptyReview().photo).toBeNull();
});
