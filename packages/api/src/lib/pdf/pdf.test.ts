import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makePdf } from "../../test/pdf";
import { sampleGopayText, sampleJagoText } from "../statements/sample";
import { statementKind } from "../statements/summary";
import { pdfText } from "./extract";
import { pageLines } from "./lines";

const webDir = join(import.meta.dir, "../../../../../apps/web");

/** The web app's extraction (its own pdfjs-dist, in a separate process). */
function webText(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "arto-pdf-"));
  const file = join(dir, "s.pdf");
  writeFileSync(file, pdf);
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "../../test/web-pdf-text.ts"), file]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}

describe("pdf text", () => {
  test("the web app and the Worker run the same pdf.js", () => {
    const web = JSON.parse(readFileSync(Bun.resolveSync("pdfjs-dist/package.json", webDir), "utf8")).version;
    const unpdf = readFileSync(Bun.resolveSync("unpdf/pdfjs", import.meta.dir), "utf8").match(/apiVersion:`([\d.]+)`/)?.[1];
    expect(unpdf).toBe(web);
  });

  for (const [name, text] of [
    ["Jago", sampleJagoText()],
    ["GoPay", sampleGopayText()],
  ] as const) {
    test(`${name}: server text equals the statement text and the web app's text`, async () => {
      const pdf = makePdf(text, { perPage: 40 });
      const server = await pdfText(pdf);
      if (!server.ok) throw new Error(server.message);
      expect(server.pages).toBeGreaterThan(1);
      expect(server.text).toBe(text);
      expect(webText(pdf)).toBe(server.text);
      // And the parsers read it.
      expect(statementKind(server.text)).toBe(name === "Jago" ? "jago" : "gopay");
    });
  }

  test("password-protected and non-PDF files are reported", async () => {
    expect(await pdfText(makePdf("secret", { encrypted: true }))).toMatchObject({ ok: false, reason: "encrypted" });
    expect(await pdfText(new TextEncoder().encode("hello"))).toMatchObject({ ok: false, reason: "invalid" });
    expect(await pdfText(new TextEncoder().encode("%PDF-1.4 garbage"))).toMatchObject({ ok: false, reason: "invalid" });
  });

  test("a new baseline starts a new line even without an end-of-line marker", () => {
    const item = (str: string, y: number, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 0, y], hasEOL });
    expect(pageLines([item("-30.000,00 ", 100), item("970.000,00", 100.4), item("Jago payment", 90), { type: "beginMarkedContent" }, item("x", 90, true), item("y", 80)])).toEqual([
      "-30.000,00 970.000,00",
      "Jago paymentx",
      "y",
    ]);
  });
});
