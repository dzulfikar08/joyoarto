import { describe, expect, test } from "bun:test";

import { emptyReceiptDraft, imageSize, lineItemsNote, normalizeReceipt, receiptDate } from "./receipt";

const ctx = {
  today: "2026-11-05",
  currency: "IDR",
  accounts: [
    { id: "gopay", name: "GoPay wallet", institution: "gopay", type: "ewallet" },
    { id: "bca", name: "BCA", institution: "bca", type: "bank" },
  ],
  categories: [
    { slug: "food/dining", name: "Eating out", kind: "expense" },
    { slug: "transport/fuel", name: "Fuel", kind: "expense" },
    { slug: "income/refund", name: "Refunds", kind: "income" },
  ],
};

describe("receipt drafts", () => {
  test("a clean answer becomes the add sheet's draft", () => {
    const r = normalizeReceipt(
      {
        totalAmount: 87500,
        merchant: "  Bakmi   GM ",
        date: "2026-11-04",
        description: "Makan siang tim",
        category: "food/dining",
        accountId: "",
        paymentMethod: "GoPay",
        lineItems: [
          { name: "Bakmi ayam", amount: 45000 },
          { name: "Es teh", amount: 0 },
        ],
      },
      ctx,
    );
    expect(r.draft).toEqual({
      amount: 8_750_000,
      direction: "out",
      merchant: "Bakmi GM",
      description: "Makan siang tim",
      note: "Rincian: Bakmi ayam Rp 45.000 · Es teh",
      category: "food/dining",
      // From the payment method printed on the receipt.
      accountId: "gopay",
      date: "2026-11-04",
      source: "ai",
    });
    expect(r.paymentMethod).toBe("GoPay");
    expect(r.lineItems).toEqual([
      { name: "Bakmi ayam", amount: 4_500_000 },
      { name: "Es teh", amount: null },
    ]);
  });

  test("bad values fall back: no amount, future or ancient date, foreign ids, income category", () => {
    const r = normalizeReceipt({ totalAmount: -5, merchant: "", date: "2026-12-01", description: "", category: "income/refund", accountId: "someone-else", paymentMethod: "", lineItems: [] }, ctx);
    expect(r.draft).toMatchObject({ amount: null, merchant: null, description: "Struk", category: null, accountId: null, date: "2026-11-05", note: null });
    expect(normalizeReceipt({ totalAmount: 10000, date: "2024-01-01" }, ctx).draft.date).toBe("2026-11-05");
    expect(normalizeReceipt(null, ctx).draft.amount).toBeNull();
  });

  test("amounts as strings in Indonesian notation; day-first dates", () => {
    const r = normalizeReceipt({ totalAmount: "Rp 1.250.000" as unknown as number, date: "03/11/2026" }, ctx);
    expect(r.draft.amount).toBe(125_000_000);
    expect(r.draft.date).toBe("2026-11-03");
  });

  test("dates", () => {
    expect(receiptDate("2026-11-04")).toBe("2026-11-04");
    expect(receiptDate("4-11-26")).toBe("2026-11-04");
    expect(receiptDate("31/02/2026")).toBeNull();
    expect(receiptDate("kemarin")).toBeNull();
  });

  test("long item lists are cut to fit the note", () => {
    const note = lineItemsNote(Array.from({ length: 40 }, (_, i) => ({ name: `Barang nomor ${i}`, amount: 1_000_000 })), "IDR")!;
    expect(note.length).toBeLessThanOrEqual(500);
    expect(note).toMatch(/\+\d+ lagi$/);
  });

  test("empty draft", () => expect(emptyReceiptDraft("2026-11-05").draft).toMatchObject({ amount: null, date: "2026-11-05", direction: "out" }));
});

describe("image size", () => {
  test("png", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 800);
    new DataView(png.buffer).setUint32(20, 1600);
    expect(imageSize(png)).toEqual({ mime: "image/png", width: 800, height: 1600 });
  });

  test("jpeg with an APP0 segment before SOF0", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x04, 0xb0, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ mime: "image/jpeg", width: 1200, height: 1600 });
  });

  test("anything else", () => {
    expect(imageSize(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });
});
