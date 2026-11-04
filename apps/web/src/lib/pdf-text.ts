import { documentText } from "@baroka/api/lib/pdf/lines";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Text of a PDF, one line per text line, pages in order. Runs in the browser. The Worker reads emailed and uploaded
 * PDFs with the same line logic and the same pdf.js version (packages/api/src/lib/pdf), so keep `pdfjs-dist` here
 * equal to the pdf.js inside `unpdf` there (a test checks it).
 */
export async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return documentText(doc);
}
