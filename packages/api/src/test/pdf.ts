// Minimal PDF writer for tests: prints text lines in Courier, each line cut into word chunks placed side by side on
// the same baseline (like the columns of a real statement), so the extractors have to join items into lines.

type Options = {
  /** Lines per page. */
  perPage?: number;
  /**
   * Adds a standard security handler with a user password: pdf.js then asks for a password (PasswordException).
   * The O/U entries are made up, which is enough for "needs a password"; nothing is really encrypted.
   */
  encrypted?: boolean;
};

const SIZE = 9;
const CHAR_W = SIZE * 0.6; // Courier: every glyph is 600/1000 em wide.

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

function pageStream(lines: string[]): string {
  const ops: string[] = [];
  lines.forEach((line, i) => {
    const y = 800 - i * 14;
    // "a b c" -> ["a ", "b ", "c"]: the spaces stay inside the chunks, so joining the items gives the line back.
    const chunks = line.match(/\S+\s*|\s+/g) ?? [];
    let x = 30;
    for (const c of chunks) {
      ops.push(`BT /F1 ${SIZE} Tf ${x.toFixed(2)} ${y} Td (${esc(c)}) Tj ET`);
      x += c.length * CHAR_W;
    }
  });
  return ops.join("\n");
}

/** A PDF whose text, read by pdf.js, is `text` (one line per line). */
export function makePdf(text: string, options: Options = {}): Uint8Array {
  const perPage = options.perPage ?? 50;
  const all = text.split("\n");
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  // Objects: 1 catalog, 2 pages, 3 font, then per page: page + content stream; then maybe the encrypt dict.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const stream = pageStream(lines);
    objects[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let encryptRef = "";
  if (options.encrypted) {
    const id = objects.length;
    const hex = (seed: number) => Array.from({ length: 32 }, (_, k) => ((k * 37 + seed) % 256).toString(16).padStart(2, "0")).join("");
    objects[id] = `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O <${hex(7)}> /U <${hex(91)}> >>`;
    encryptRef = ` /Encrypt ${id} 0 R /ID [<${hex(3).slice(0, 32)}> <${hex(3).slice(0, 32)}>]`;
  }

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R${encryptRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  // Latin-1: one byte per character, so the offsets above are byte offsets.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
