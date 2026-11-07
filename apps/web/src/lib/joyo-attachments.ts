// Files attached to a Joyo AI question, read in the browser before sending: photos and screenshots become a JPEG about
// 1600 px on the long side, a PDF becomes its text (or, when it is a scan with no text, its first pages as images), and a
// CSV/TSV table is sent as text. Nothing is uploaded on its own: the result rides with the question and is not stored.

import type { AppRouterClient } from "@baroka/api/routers/index";

import { fitWithin } from "./receipt-image";

export type ChatAttachmentIn = NonNullable<Parameters<AppRouterClient["joyo"]["chat"]>[0]["attachments"]>[number];

export const MAX_ATTACHMENTS = 3;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEXT_CHARS = 30_000;
/** A PDF with less text than this is treated as a scan. */
const MIN_PDF_TEXT = 40;
const SCAN_PAGES = 2;
export const ACCEPT = "image/*,application/pdf,.pdf,.csv,.tsv,.txt";

export type AttachmentKind = "image" | "pdf" | "table" | "excel";

/** What a file is, from its type and name; null when Joyo cannot read it. */
export function attachmentKind(name: string, type: string): AttachmentKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (["csv", "tsv", "txt"].includes(ext) || type === "text/csv" || type === "text/tab-separated-values" || type === "text/plain") return "table";
  if (["xlsx", "xls", "ods", "numbers"].includes(ext)) return "excel";
  return null;
}

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: { name: string; type: string; size: number }): string | null {
  const kind = attachmentKind(file.name, file.type);
  if (kind === "excel") return "Spreadsheets: save it as CSV, or attach a screenshot of the table.";
  if (!kind) return "Joyo can read photos, screenshots, PDFs and CSV tables.";
  if (file.size > MAX_FILE_BYTES) return "That file is over 20 MB.";
  return null;
}

/** Cap a text attachment, saying so when it was cut. */
export function capText(text: string, max = TEXT_CHARS): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  return t.length <= max ? t : `${t.slice(0, max)}\n[… cut: the file is longer]`;
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<string> {
  const url = canvas.toDataURL("image/jpeg", 0.8);
  return url.slice(url.indexOf(",") + 1);
}

async function imageAttachment(file: File): Promise<ChatAttachmentIn> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare the image.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { kind: "image", name: file.name.slice(0, 120), mediaType: "image/jpeg", data: await canvasJpeg(canvas) };
  } finally {
    bitmap.close();
  }
}

async function scannedPages(file: File): Promise<ChatAttachmentIn[]> {
  const pdfjs = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: ChatAttachmentIn[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, SCAN_PAGES); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const { width } = fitWithin(base.width, base.height);
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't read the PDF.");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    out.push({ kind: "image", name: `${file.name.slice(0, 100)} (page ${n})`, mediaType: "image/jpeg", data: await canvasJpeg(canvas) });
  }
  return out;
}

/** The file as Joyo gets it (a scanned PDF can give two images). Throws an Error with a message for the member. */
export async function readAttachment(file: File): Promise<ChatAttachmentIn[]> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);
  const kind = attachmentKind(file.name, file.type)!;
  if (kind === "image") return [await imageAttachment(file)];
  if (kind === "table") return [{ kind: "text", name: file.name.slice(0, 120), text: capText(await file.text()) }];
  const { pdfText } = await import("./pdf-text");
  let text = "";
  try {
    text = await pdfText(file);
  } catch {
    throw new Error("This PDF can't be read here (password-protected?).");
  }
  if (text.trim().length >= MIN_PDF_TEXT) return [{ kind: "text", name: file.name.slice(0, 120), text: capText(text) }];
  return scannedPages(file);
}
