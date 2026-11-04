// How JoyoArto turns a PDF's text into lines, shared by the browser (apps/web/src/lib/pdf-text.ts, pdfjs-dist) and the
// Worker (./extract.ts, unpdf). The statement parsers in ../statements depend on this exact layout, so both sides call
// the same function on pdf.js's getTextContent() items and cannot drift apart.

/** The part of a pdf.js document we use: the browser's pdfjs-dist and the Worker's unpdf build both fit. */
export type PdfDocumentLike = {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>;
};

/** One page's items as lines: a pdf.js end-of-line marker or a new baseline (wrapped table cells) ends a line. */
export function pageLines(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let line = "";
  let y: number | null = null;
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as { str: string; transform: number[]; hasEOL?: boolean };
    // A new baseline is a new line even when pdf.js does not mark one.
    const itemY = item.transform[5] as number;
    if (line && y !== null && Math.abs(itemY - y) > 1) {
      lines.push(line);
      line = "";
    }
    y = itemY;
    line += item.str;
    if (item.hasEOL) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Text of a loaded PDF, one line per text line, pages in order. */
export async function documentText(doc: PdfDocumentLike): Promise<string> {
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    lines.push(...pageLines(content.items));
  }
  return lines.join("\n");
}
