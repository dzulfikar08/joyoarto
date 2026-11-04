// PDF text on the server (Cloudflare Worker, Bun tests) with unpdf's serverless pdf.js build, in the same line layout
// the web app produces (./lines.ts).

import { getDocumentProxy } from "unpdf";

import { documentText } from "./lines";

export type PdfTextResult =
  | { ok: true; text: string; pages: number }
  | { ok: false; reason: "encrypted" | "invalid"; message: string };

/** Upper bound for an uploaded or emailed statement PDF. Real monthly statements are well under 2 MB. */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

/** "%PDF-" in the first KB (some generators put junk before it). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/** Text of a PDF, one line per text line. Password-protected and unreadable files are reported, not thrown. */
export async function pdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  if (!looksLikePdf(bytes)) return { ok: false, reason: "invalid", message: "This file is not a PDF." };
  let doc: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // pdf.js takes ownership of the buffer it is given; copy so callers keep theirs.
    doc = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: false, verbosity: 0 });
    const text = await documentText(doc);
    return { ok: true, text, pages: doc.numPages };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") {
      return { ok: false, reason: "encrypted", message: "This PDF is password-protected." };
    }
    return { ok: false, reason: "invalid", message: `This PDF could not be read (${name ?? "error"}).` };
  } finally {
    await doc?.cleanup().catch(() => undefined);
  }
}
