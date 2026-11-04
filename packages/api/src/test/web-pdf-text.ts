// Test helper, run as its own process: extracts a PDF's text with the web app's pdfjs-dist (the build the browser
// loads) and the shared line logic, so the parity test compares the two pdf.js copies without them sharing globals.
// Usage: bun src/test/web-pdf-text.ts <file.pdf>  -> text on stdout

import { join } from "node:path";

import { documentText } from "../lib/pdf/lines";

const webDir = join(import.meta.dir, "../../../../apps/web");
const pdfjs = await import(Bun.resolveSync("pdfjs-dist/legacy/build/pdf.mjs", webDir));
const data = new Uint8Array(await Bun.file(process.argv[2]!).arrayBuffer());
const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
process.stdout.write(await documentText(doc));
