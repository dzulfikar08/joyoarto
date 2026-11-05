// The reimbursement claim report as a PDF (pdf-lib, which runs in Workers): header, item table, subtotals per
// category, the total in numbers and words, signature blocks, then one appendix page per receipt photo. Drawn from a
// ClaimSnapshot (lib/reimburse.ts), so a re-download prints the same document. Labels are Indonesian first.
// Receipts: 2 × 2 per A4 page in table order, captioned with the row number; a long receipt (taller than 1:2.2) gets
// both rows of a column so it stays readable.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";

import { formatMoney } from "./money";
import { longDate } from "./reimburse";
import type { ClaimSnapshot } from "./reimburse";

export type ImageLoader = (attachmentId: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const INK = rgb(0.11, 0.11, 0.13);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const FILL = rgb(0.95, 0.95, 0.96);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Photo = { image: PDFImage | null; caption: string };

/** The receipts grid: a full page holds 2 rows of about 255 × 340 pt photos plus a 2-line caption each. */
const GRID = (() => {
  const header = 24;
  const gap = 12;
  const rows = 2;
  return { cols: 2, rows, gap, header, rowH: (A4.h - 2 * M - header - (rows - 1) * gap) / rows, caption: 24, captionSize: 7.5, captionLine: 9.5, tall: 2.2 };
})();

/** Where each receipt goes: page, row, column and how many rows it spans. Row by row in the given order (never
 * reordered); a photo taller than 1:2.2 takes the next column with both rows free, so the grid may leave a hole
 * rather than move it ahead of later ones. The first page may have only `firstRows` rows (under the signatures). */
export function layoutReceipts(
  images: readonly ({ width: number; height: number } | null)[],
  firstRows: number = GRID.rows,
): { page: number; row: number; col: number; span: number }[] {
  const out: { page: number; row: number; col: number; span: number }[] = [];
  let page = 0;
  let rows = Math.max(1, Math.min(GRID.rows, firstRows));
  let taken = new Set<number>();
  let cursor = 0;
  const next = () => {
    page++;
    rows = GRID.rows;
    taken = new Set();
    cursor = 0;
  };
  for (const img of images) {
    const tall = !!img && img.height > img.width * GRID.tall;
    if (tall) {
      while (cursor < GRID.cols * rows && taken.has(cursor)) cursor++;
      if (rows < 2 || cursor >= GRID.cols) next();
      const col = cursor;
      taken.add(col).add(GRID.cols + col);
      out.push({ page, row: 0, col, span: 2 });
      cursor = col + 1;
      continue;
    }
    while (cursor < GRID.cols * rows && taken.has(cursor)) cursor++;
    if (cursor >= GRID.cols * rows) next();
    taken.add(cursor);
    out.push({ page, row: Math.floor(cursor / GRID.cols), col: cursor % GRID.cols, span: 1 });
    cursor++;
  }
  return out;
}

async function embedImage(doc: PDFDocument, img: { bytes: Uint8Array; mime: string } | null): Promise<PDFImage | null> {
  try {
    if (img?.mime === "image/jpeg") return await doc.embedJpg(img.bytes);
    if (img?.mime === "image/png") return await doc.embedPng(img.bytes);
  } catch {
    // A broken file prints as "could not be included" instead of failing the report.
  }
  return null;
}

/** 2026-10-12 as "12 Okt 2026". */
function shortDate(day: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

/** Standard PDF fonts only know WinAnsi: anything else (emoji, CJK) becomes "?" instead of failing the report. */
function safeText(font: PDFFont, text: string, cache: Map<string, boolean>): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/[\r\n\t]+/g, " ")) {
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    if (ok) out += ch;
    else {
      const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += plain && plain !== ch && [...plain].every((c) => cache.get(c) !== false) ? plain : "?";
    }
  }
  return out;
}

/** Words wrapped to a width; a single word longer than the width is cut. */
function wrap(font: PDFFont, size: number, text: string, width: number, maxLines = 99): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    let w = word;
    while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    line = w;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines.length ? lines : [""];
}

export async function claimPdf(s: ClaimSnapshot, loadImage: ImageLoader): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Klaim ${s.number} – ${s.company}`);
  doc.setAuthor(s.claimant.name);
  doc.setSubject(`Reimbursement claim ${s.number}`);
  doc.setProducer("JoyoArto");
  doc.setCreator("JoyoArto");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const cache = new Map<string, boolean>();
  const T = (text: string | null | undefined) => safeText(fonts.regular, text ?? "", cache);
  const money = (minor: number) => formatMoney(minor, s.currency);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const text = (p: PDFPage, str: string, x: number, yy: number, size = 9, font = fonts.regular, color = INK) => p.drawText(T(str), { x, y: yy, size, font, color });
  const right = (p: PDFPage, str: string, xRight: number, yy: number, size = 9, font = fonts.regular, color = INK) =>
    p.drawText(T(str), { x: xRight - font.widthOfTextAtSize(T(str), size), y: yy, size, font, color });
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M;
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 24) newPage();
  };

  // ---- header
  text(page, "LAPORAN KLAIM REIMBURSEMENT", M, y - 14, 15, fonts.bold);
  text(page, "Reimbursement claim report", M, y - 28, 9, fonts.regular, MUTED);
  right(page, `No. ${s.number}`, A4.w - M, y - 12, 11, fonts.bold);
  right(page, `Tanggal / Date: ${longDate(s.issuedOn)}`, A4.w - M, y - 26, 8.5, fonts.regular, MUTED);
  right(page, `Periode / Period: ${longDate(s.periodFrom)} – ${longDate(s.periodTo)}`, A4.w - M, y - 38, 8.5, fonts.regular, MUTED);
  y -= 52;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: RULE });
  y -= 16;

  const info: [string, string][] = [
    ["Perusahaan / Company", s.company],
    ["Pemohon / Claimant", s.claimant.name],
    ...(s.claimant.employeeId ? ([["NIK / Employee ID", s.claimant.employeeId]] as [string, string][]) : []),
    ...(s.claimant.department ? ([["Departemen / Department", s.claimant.department]] as [string, string][]) : []),
    ...(s.approver.name || s.approver.email ? ([["Penyetuju / Approver", [s.approver.name, s.approver.email ? `<${s.approver.email}>` : null].filter(Boolean).join(" ")]] as [string, string][]) : []),
    ["Jumlah item / Items", String(s.items.length)],
  ];
  const colW = (A4.w - 2 * M) / 2;
  info.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y - Math.floor(i / 2) * 26;
    text(page, label, x, yy, 7.5, fonts.regular, MUTED);
    text(page, wrap(fonts.bold, 10, T(value), colW - 12, 1)[0]!, x, yy - 11, 10, fonts.bold);
  });
  y -= Math.ceil(info.length / 2) * 26 + 4;

  if (s.notes) {
    text(page, "Keperluan / Purpose", M, y, 7.5, fonts.regular, MUTED);
    y -= 11;
    for (const line of wrap(fonts.regular, 9.5, T(s.notes), A4.w - 2 * M, 6)) {
      text(page, line, M, y, 9.5);
      y -= 12;
    }
    y -= 4;
  }
  y -= 6;

  // ---- table
  const cols = [
    { key: "no", label: "No", w: 22, align: "left" },
    { key: "date", label: "Tanggal\nDate", w: 54, align: "left" },
    { key: "merchant", label: "Merchant", w: 92, align: "left" },
    { key: "description", label: "Keterangan / Keperluan\nDescription / Purpose", w: 133, align: "left" },
    { key: "category", label: "Kategori\nCategory", w: 76, align: "left" },
    { key: "paidWith", label: "Metode bayar\nPaid with", w: 70, align: "left" },
    { key: "amount", label: "Jumlah\nAmount", w: 0, align: "right" },
  ] as const;
  const tableW = A4.w - 2 * M;
  const widths: number[] = cols.map((c) => c.w);
  widths[widths.length - 1] = tableW - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const PAD = 4;

  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 24, width: tableW, height: 24, color: FILL });
    cols.forEach((c, i) => {
      c.label.split("\n").forEach((l, j) => {
        const yy = y - 10 - j * 9;
        const size = j ? 6.5 : 7.5;
        const font = j ? fonts.regular : fonts.bold;
        if (c.align === "right") right(page, l, xs[i]! + widths[i]! - PAD, yy, size, font, j ? MUTED : INK);
        else text(page, l, xs[i]! + PAD, yy, size, font, j ? MUTED : INK);
      });
    });
    y -= 24;
  };
  ensure(60);
  drawHead();

  for (const item of s.items) {
    const cells = [
      [String(item.no)],
      [item.date],
      wrap(fonts.regular, 8, T(item.merchant), widths[2]! - 2 * PAD, 3),
      [...wrap(fonts.regular, 8, T(item.description), widths[3]! - 2 * PAD, 3), ...(item.attachmentIds.length ? [] : ["(tanpa bukti)"])],
      wrap(fonts.regular, 8, T(item.category ?? "–"), widths[4]! - 2 * PAD, 2),
      wrap(fonts.regular, 8, T(item.paidWith), widths[5]! - 2 * PAD, 2),
      [money(item.amount)],
    ];
    const lines = Math.max(...cells.map((c) => c.length));
    const h = lines * 10 + 8;
    if (y - h < M + 24) {
      newPage();
      drawHead();
    }
    cells.forEach((cell, i) => {
      cell.forEach((l, j) => {
        const yy = y - 11 - j * 10;
        const muted = l === "(tanpa bukti)";
        if (cols[i]!.align === "right") right(page, l, xs[i]! + widths[i]! - PAD, yy, 8, fonts.regular);
        else text(page, l, xs[i]! + PAD, yy, muted ? 7 : 8, muted ? fonts.italic : fonts.regular, muted ? MUTED : INK);
      });
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: RULE });
  }

  // ---- subtotals, total, in words
  const labelX = xs[4]! + PAD;
  const amountX = A4.w - M - PAD;
  ensure(30 + s.subtotals.length * 12);
  y -= 14;
  text(page, "Subtotal per kategori / by category", labelX, y, 7.5, fonts.bold, MUTED);
  y -= 12;
  for (const sub of s.subtotals) {
    ensure(14);
    text(page, `${sub.category} (${sub.count})`, labelX, y, 8.5);
    right(page, money(sub.amount), amountX, y, 8.5);
    y -= 12;
  }
  ensure(44);
  y -= 2;
  page.drawRectangle({ x: labelX - PAD, y: y - 8, width: A4.w - M - labelX + PAD, height: 20, color: FILL });
  text(page, "TOTAL", labelX, y - 1, 10, fonts.bold);
  right(page, money(s.total), amountX, y - 1, 11, fonts.bold);
  y -= 24;
  text(page, "Terbilang / In words:", M, y, 7.5, fonts.regular, MUTED);
  y -= 11;
  for (const line of wrap(fonts.italic, 9.5, T(`${s.totalInWords}.`), A4.w - 2 * M, 3)) {
    text(page, line, M, y, 9.5, fonts.italic);
    y -= 12;
  }

  // ---- signatures
  ensure(110);
  y -= 22;
  const sigW = (A4.w - 2 * M) / 3;
  const sigs: [string, string, string | null][] = [
    ["Diajukan oleh", "Claimant", s.claimant.name],
    ["Disetujui oleh", "Approver", s.approver.name],
    ["Diproses oleh", "Finance", null],
  ];
  sigs.forEach(([id, en, name], i) => {
    const x = M + i * sigW;
    text(page, id, x, y, 8.5, fonts.bold);
    text(page, en, x, y - 10, 7.5, fonts.regular, MUTED);
    page.drawLine({ start: { x, y: y - 62 }, end: { x: x + sigW - 24, y: y - 62 }, thickness: 0.6, color: INK });
    text(page, name ? wrap(fonts.regular, 8.5, T(name), sigW - 24, 1)[0]! : "Nama / Name:", x, y - 74, 8.5, fonts.regular, name ? INK : MUTED);
    text(page, "Tanggal / Date: ____________", x, y - 88, 8, fonts.regular, MUTED);
  });
  y -= 100;

  // ---- items without a receipt, under the signatures (before the photos so it rarely needs a page of its own)
  const missing = s.items.filter((i) => !i.attachmentIds.length);
  if (missing.length) {
    ensure(40);
    y -= 6;
    text(page, "Item tanpa bukti / Items without a receipt", M, y - 12, 10, fonts.bold);
    y -= 26;
    for (const item of missing) {
      ensure(14);
      text(page, wrap(fonts.regular, 8.5, T(`${item.no}. ${item.date} · ${item.merchant} · ${money(item.amount)} — tanpa bukti`), A4.w - 2 * M, 1)[0]!, M, y, 8.5);
      y -= 12;
    }
    y -= 10;
  }

  // ---- appendix: the receipt photos in a grid, in table order
  const embeddedById = new Map<string, PDFImage | null>();
  const photos: Photo[] = [];
  for (const item of s.items) {
    for (const [n, id] of item.attachmentIds.entries()) {
      if (!embeddedById.has(id)) embeddedById.set(id, await embedImage(doc, await loadImage(id).catch(() => null)));
      const image = embeddedById.get(id) ?? null;
      const part = item.attachmentIds.length > 1 ? ` (${n + 1}/${item.attachmentIds.length})` : "";
      photos.push({ image, caption: `${item.no}${part} · ${shortDate(item.date)} · ${item.merchant} · ${money(item.amount)}` });
    }
  }
  const headed: { page: PDFPage; top: number }[] = [];
  if (photos.length) {
    // The signature block leaves 12 pt under its last line; the receipts may start just under it, but only when a full
    // grid row fits there (a smaller photo would be hard to read).
    if (!missing.length) y += 8;
    const underSignatures = photos.length < GRID.cols * GRID.rows && y - GRID.header - GRID.rowH >= M;
    const slots = layoutReceipts(
      photos.map((p) => p.image),
      underSignatures ? Math.min(GRID.rows, Math.floor((y - GRID.header - M + GRID.gap) / (GRID.rowH + GRID.gap))) : GRID.rows,
    );
    let current = -1;
    let top = 0;
    for (const [i, slot] of slots.entries()) {
      if (slot.page !== current) {
        if (!(slot.page === 0 && underSignatures)) newPage();
        current = slot.page;
        headed.push({ page, top: y });
        top = y - GRID.header;
      }
      const cellW = (A4.w - 2 * M - GRID.gap) / 2;
      const cellH = slot.span * GRID.rowH + (slot.span - 1) * GRID.gap;
      const x = M + slot.col * (cellW + GRID.gap);
      const cellTop = top - slot.row * (GRID.rowH + GRID.gap);
      const photo = photos[i]!;
      // The photo and its caption as one block, centred in the cell.
      const lines = wrap(fonts.regular, GRID.captionSize, T(photo.caption), cellW, 2);
      const boxH = cellH - GRID.caption;
      const scale = photo.image ? Math.min(cellW / photo.image.width, boxH / photo.image.height, 1) : 1;
      const w = photo.image ? photo.image.width * scale : cellW;
      const h = photo.image ? photo.image.height * scale : Math.min(boxH, 120);
      const blockH = h + 4 + lines.length * GRID.captionLine;
      const iy = cellTop - (cellH - blockH) / 2 - h;
      const ix = x + (cellW - w) / 2;
      if (photo.image) page.drawImage(photo.image, { x: ix, y: iy, width: w, height: h });
      page.drawRectangle({ x: ix, y: iy, width: w, height: h, borderColor: RULE, borderWidth: 0.5 });
      if (!photo.image) {
        wrap(fonts.italic, 8, "Foto tidak dapat ditampilkan / The photo could not be included.", cellW - 16).forEach((l, j) =>
          text(page, l, x + 8, iy + h / 2 - j * 10, 8, fonts.italic, MUTED),
        );
      }
      lines.forEach((l, j) => text(page, l, x + (cellW - fonts.regular.widthOfTextAtSize(l, GRID.captionSize)) / 2, iy - 4 - GRID.captionSize - j * GRID.captionLine + 1, GRID.captionSize));
    }
  }
  // ---- footers
  const pages = doc.getPages();
  for (const { page: p, top } of headed) {
    const n = pages.indexOf(p) + 1;
    text(p, "Lampiran bukti / Receipts", M, top - 12, 11, fonts.bold);
    right(p, `No. ${s.number} · Halaman ${n} / ${pages.length}`, A4.w - M, top - 12, 8.5, fonts.regular, MUTED);
    p.drawLine({ start: { x: M, y: top - 18 }, end: { x: A4.w - M, y: top - 18 }, thickness: 0.8, color: RULE });
  }
  pages.forEach((p, i) => {
    text(p, `JoyoArto · ${s.number} · ${s.company}`, M, 20, 7, fonts.regular, MUTED);
    right(p, `Halaman ${i + 1} / ${pages.length}`, A4.w - M, 20, 7, fonts.regular, MUTED);
  });
  return doc.save();
}
