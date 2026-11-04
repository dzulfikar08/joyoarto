// Share cards (Open Graph / X) for the public site: 1200×630 PNGs in public/og/, plus public/og.png (the default).
// Text becomes paths through satori with Plus Jakarta Sans from @fontsource (local files, no network), then resvg
// renders the PNG. The PNGs are checked in; run this only when the copy or brand changes:
//
//   bun scripts/og.ts            (from apps/web)
//
// Copy lives in src/lib/seo.ts (OG_CARDS) so the alt text and the picture say the same thing.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { OG_CARDS, type OgCard } from "../src/lib/seo";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const fontDir = join(web, "node_modules/@fontsource/plus-jakarta-sans/files");
const font = (w: 500 | 700 | 800) => ({
  name: "Plus Jakarta Sans",
  data: readFileSync(join(fontDir, `plus-jakarta-sans-latin-${w}-normal.woff`)),
  weight: w,
  style: "normal" as const,
});

// Brand (packages/ui tokens, public/icon.svg).
const PAPER = "#f9f6f1";
const INK = "#1d1a14";
const MUTED = "#6b655c";
const ARTO = "#3752ae";
const COIN = "#eebc4a";
const SOFT = "#e4eaff";

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});
const box = (style: Record<string, unknown>, ...children: (Node | string)[]) => h("div", { display: "flex", ...style }, ...children);

const MARK = `data:image/svg+xml;base64,${Buffer.from(readFileSync(join(web, "public/icon.svg"))).toString("base64")}`;

/** satori applies no kerning, so a heavy "a." gets a gap; pull a trailing full stop back in. */
const line = (text: string) => (text.endsWith(".") ? [text.slice(0, -1), h("span", { marginLeft: -9 }, ".")] : [text]);

function card(c: OgCard): Node {
  return box(
    { width: 1200, height: 630, background: PAPER, fontFamily: "Plus Jakarta Sans", color: INK, position: "relative", overflow: "hidden" },
    // Soft arto-blue disc and the gold coin, bottom right: the brand without a screenshot to squint at.
    box({ position: "absolute", right: -120, bottom: -180, width: 420, height: 420, borderRadius: 9999, background: SOFT }),
    box({ position: "absolute", right: 90, bottom: 90, width: 120, height: 120, borderRadius: 9999, background: COIN, border: "12px solid #f6d57f" }),
    box(
      { flexDirection: "column", position: "absolute", top: 64, left: 80, right: 80, bottom: 64 },
      box(
        { alignItems: "center" },
        { type: "img", props: { src: MARK, width: 72, height: 72, style: { borderRadius: 18 } } },
        box({ marginLeft: 20, fontSize: 40, fontWeight: 800, letterSpacing: -0.5 }, "Joyo", h("span", { color: ARTO }, "Arto")),
        c.eyebrow
          ? box({ marginLeft: 24, padding: "8px 20px", borderRadius: 9999, background: SOFT, color: ARTO, fontSize: 26, fontWeight: 700 }, c.eyebrow)
          : box({}),
      ),
      box(
        { flexDirection: "column", marginTop: 72, maxWidth: 1000 },
        box({ fontSize: 74, fontWeight: 800, lineHeight: 1.08 }, ...line(c.title[0])),
        box({ fontSize: 74, fontWeight: 800, lineHeight: 1.08, color: ARTO, marginTop: 6 }, ...line(c.title[1])),
      ),
      box({ marginTop: "auto", fontSize: 30, fontWeight: 500, color: MUTED, maxWidth: 800, lineHeight: 1.35 }, c.sub),
    ),
  );
}

const fonts = [font(500), font(700), font(800)];
mkdirSync(join(web, "public/og"), { recursive: true });
for (const c of OG_CARDS) {
  const svg = await satori(card(c) as never, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  const out = join(web, "public", c.file);
  writeFileSync(out, png);
  console.log(`${c.file}  ${(png.length / 1024).toFixed(0)} KB`);
}
