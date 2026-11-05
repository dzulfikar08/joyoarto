import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import { makePng } from "../test/image";
import { claimPdf, layoutReceipts } from "./claim-pdf";
import { pdfText } from "./pdf/extract";
import { buildSnapshot } from "./reimburse";

const header = {
  number: "RB-2026-0042",
  issuedOn: "2026-11-05",
  currency: "IDR",
  company: "PT Maju Jaya",
  claimant: { name: "Dewi", employeeId: null, department: null },
  approver: { name: "Budi", email: null },
  notes: null,
};
const item = (n: number, photos: string[]) => ({
  transactionId: `t${n}`,
  date: `2026-10-${String(10 + n).padStart(2, "0")}`,
  merchant: n === 2 ? "Kopi Kenangan" : `Merchant ${n}`,
  description: "Makan siang klien",
  category: "Makan",
  paidWith: "GoPay",
  amount: 2_500_000,
  note: null,
  attachmentIds: photos,
});

const PORTRAIT = makePng(90, 160);
const TALL = makePng(50, 160);
const images: Record<string, { bytes: Uint8Array; mime: string }> = {
  p: { bytes: PORTRAIT, mime: "image/png" },
  tall: { bytes: TALL, mime: "image/png" },
};
const loader = async (id: string) => images[id.split("-")[0]!] ?? null;

async function render(items: ReturnType<typeof item>[], notes: string | null = null) {
  const bytes = await claimPdf(buildSnapshot({ ...header, notes }, items), loader);
  const doc = await PDFDocument.load(bytes);
  const text = await pdfText(bytes);
  if (!text.ok) throw new Error(text.message);
  let imageObjects = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) imageObjects++;
  }
  return { pages: doc.getPageCount(), text: text.text, imageObjects, bytes };
}

describe("receipt grid layout", () => {
  const photo = { width: 900, height: 1600 };
  const tall = { width: 500, height: 1600 };

  test("2 × 2 per page, in order", () => {
    expect(layoutReceipts([photo, photo, photo, photo, photo])).toEqual([
      { page: 0, row: 0, col: 0, span: 1 },
      { page: 0, row: 0, col: 1, span: 1 },
      { page: 0, row: 1, col: 0, span: 1 },
      { page: 0, row: 1, col: 1, span: 1 },
      { page: 1, row: 0, col: 0, span: 1 },
    ]);
  });

  test("a long receipt takes both rows of a column; never moved ahead of later photos", () => {
    expect(layoutReceipts([photo, tall, photo])).toEqual([
      { page: 0, row: 0, col: 0, span: 1 },
      { page: 0, row: 0, col: 1, span: 2 },
      { page: 0, row: 1, col: 0, span: 1 },
    ]);
    expect(layoutReceipts([photo, photo, tall, photo])).toEqual([
      { page: 0, row: 0, col: 0, span: 1 },
      { page: 0, row: 0, col: 1, span: 1 },
      { page: 1, row: 0, col: 0, span: 2 },
      { page: 1, row: 0, col: 1, span: 1 },
    ]);
    // 1:2.2 is still a normal cell; a missing image too.
    expect(layoutReceipts([{ width: 100, height: 220 }, null]).map((s) => s.span)).toEqual([1, 1]);
  });

  test("only one row under the signatures: a long receipt starts the next page", () => {
    expect(layoutReceipts([photo, photo, photo], 1).map((s) => [s.page, s.row, s.col])).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ]);
    expect(layoutReceipts([tall], 1)).toEqual([{ page: 1, row: 0, col: 0, span: 2 }]);
  });
});

describe("claim pdf", () => {
  test("no photos: the report page only", async () => {
    const r = await render([item(1, []), item(2, [])]);
    expect(r.pages).toBe(1);
    expect(r.text).toContain("Item tanpa bukti / Items without a receipt");
    expect(r.text).not.toContain("Lampiran bukti");
  });

  test("one photo fits under the signatures of a short claim", async () => {
    const r = await render([item(2, ["p-1"])]);
    expect(r.pages).toBe(1);
    expect(r.text).toContain("Lampiran bukti / Receipts");
    expect(r.text).toContain("1 · 12 Okt 2026 · Kopi Kenangan · Rp 25.000");
  });

  test("one photo on its own page when a full row does not fit", async () => {
    const r = await render([item(1, []), item(2, ["p-1"])], "Kunjungan klien Bandung, dua hari.");
    expect(r.pages).toBe(2);
    expect(r.text).toContain("No. RB-2026-0042 · Halaman 2 / 2");
  });

  test("5 photos: two appendix pages with the header on each, captions in table order", async () => {
    const r = await render([item(1, ["p-1"]), item(2, ["p-2", "p-3"]), item(3, ["p-4"]), item(4, []), item(5, ["p-5"])]);
    expect(r.pages).toBe(3);
    expect(r.text).toContain("Halaman 2 / 3");
    expect(r.text).toContain("Halaman 3 / 3");
    expect(r.text.match(/Lampiran bukti \/ Receipts/g)?.length).toBe(2);
    expect(r.text).toContain("2 (1/2) · 12 Okt 2026 · Kopi Kenangan · Rp 25.000");
    expect(r.text).toContain("2 (2/2) · 12 Okt 2026");
    const order = ["1 · 11 Okt", "2 (1/2)", "2 (2/2)", "3 · 13 Okt", "5 · 15 Okt"].map((c) => r.text.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a long receipt gets a double cell, so 4 photos need a second page", async () => {
    const r = await render([item(1, ["p-1"]), item(2, ["tall-1"]), item(3, ["p-2"]), item(4, ["p-3"])]);
    // Page 2: photo 1, the long receipt in column 2, photo 3 under photo 1; page 3: photo 4.
    expect(r.pages).toBe(3);
  });

  test("each image is embedded once; captions are ellipsised; unreadable photos are noted", async () => {
    const shared = { ...item(1, ["p-1"]), merchant: "Indomaret ".repeat(30) };
    const r = await render([shared, item(2, ["p-1"]), item(3, ["broken-1"])]);
    expect(r.imageObjects).toBe(1);
    expect(r.text).toContain("…");
    expect(r.text).toContain("Foto tidak dapat ditampilkan");
  });
});
