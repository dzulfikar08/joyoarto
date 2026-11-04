// Checks the build output (apps/web/dist) the way a link-preview scraper or a crawler without JavaScript reads it:
// every public page has its own HTML with the required head tags, valid JSON-LD, a canonical on arto.joyorogo.com and
// share images of the right size. CI builds before testing; locally run `bunx vite build` first (skipped otherwise).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { SITE_URL } from "./brand";
import { PAGES, url } from "./seo";

const web = join(import.meta.dir, "../..");
const dist = join(web, "dist");
const built = existsSync(join(dist, "sitemap.xml"));
if (!built && process.env.CI) throw new Error("dist/ has no prerendered pages: run `bunx vite build` before the tests");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string) {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const attr = (html: string, sel: RegExp) => sel.exec(html)?.[1];
const meta = (html: string, key: string) =>
  attr(html, new RegExp(`<meta (?:name|property)="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`));

describe.skipIf(!built)("prerendered public pages", () => {
  for (const page of PAGES) {
    test(`${page.path} (${page.file})`, () => {
      const html = readFileSync(join(dist, page.file), "utf8");
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain('<html lang="id">');
      expect(attr(html, /<title>([^<]*)<\/title>/)).toBe(page.title.replace(/&/g, "&amp;"));
      expect((html.match(/<title>/g) ?? []).length).toBe(1);
      expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(url(page.path));
      expect(url(page.path).startsWith(`${SITE_URL}/`) || url(page.path) === SITE_URL).toBe(true);
      expect(meta(html, "robots")).toContain("index");
      for (const key of [
        "description",
        "og:type",
        "og:url",
        "og:title",
        "og:description",
        "og:image",
        "og:image:width",
        "og:image:height",
        "og:image:alt",
        "og:site_name",
        "og:locale",
        "og:locale:alternate",
        "twitter:card",
        "twitter:title",
        "twitter:description",
        "twitter:image",
        "theme-color",
      ]) {
        expect(meta(html, key), `${page.file}: ${key}`).toBeTruthy();
        expect((html.match(new RegExp(`(?:name|property)="${key.replace(/[.:]/g, "\\$&")}"`, "g")) ?? []).length, `${page.file}: one ${key}`).toBeLessThanOrEqual(2);
      }
      expect(meta(html, "og:url")).toBe(url(page.path));
      expect(meta(html, "og:locale")).toBe("id_ID");
      expect(meta(html, "og:locale:alternate")).toBe("en_US");
      expect(meta(html, "twitter:card")).toBe("summary_large_image");
      expect(html).not.toContain("hreflang");
      expect(html).not.toContain("%VITE_");

      // Share image: absolute, on the public site, a 1200×630 PNG under 300 KB that the build ships.
      const image = meta(html, "og:image")!;
      expect(image.startsWith(`${SITE_URL}/`)).toBe(true);
      const file = join(dist, new URL(image).pathname);
      expect(pngSize(file)).toEqual({ width: Number(meta(html, "og:image:width")), height: Number(meta(html, "og:image:height")) });
      expect(pngSize(file)).toEqual({ width: 1200, height: 630 });
      expect(statSync(file).size).toBeLessThan(300 * 1024);

      // JSON-LD parses and has what Google's rich results need.
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
      expect(blocks.length).toBe(1);
      const graph = blocks[0]["@graph"] as Record<string, any>[];
      expect(blocks[0]["@context"]).toBe("https://schema.org");
      const byType = (t: string) => graph.find((n) => n["@type"] === t);
      expect(byType("Organization")).toMatchObject({ name: "JoyoDigitama", url: expect.any(String), logo: expect.any(Object) });
      expect(byType("WebSite")).toMatchObject({ url: `${SITE_URL}/`, name: "JoyoArto" });
      expect(byType("WebPage")).toMatchObject({ url: url(page.path), name: page.title });
      if (page.path === "/" || page.path === "/pricing") {
        const app = byType("SoftwareApplication")!;
        expect(app).toMatchObject({ name: "JoyoArto", applicationCategory: "FinanceApplication", operatingSystem: "Web, Android" });
        for (const o of app.offers) expect(o).toMatchObject({ "@type": "Offer", price: expect.stringMatching(/^\d+$/), priceCurrency: "IDR" });
      }
      if (page.path === "/") {
        const faq = byType("FAQPage")!;
        expect(faq.mainEntity.length).toBeGreaterThan(0);
        for (const q of faq.mainEntity) expect(q).toMatchObject({ "@type": "Question", name: expect.any(String), acceptedAnswer: { "@type": "Answer", text: expect.any(String) } });
      }

      // Body for crawlers without JavaScript, next to (not inside) the app root; the font is preloaded.
      expect(html).toMatch(/<div id="prerender">[\s\S]*<h1>[^<]+<\/h1>[\s\S]*<\/div>\s*<div id="app"><\/div>/);
      expect(html).toMatch(/<link rel="preload" href="\/assets\/plus-jakarta-sans-latin-wght-normal-[^"]+\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
      expect(html).toContain('<script type="module" crossorigin src="/assets/index-');
    });
  }

  test("sitemap.xml lists exactly the public pages with lastmod", () => {
    const xml = readFileSync(join(dist, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(PAGES.map((p) => url(p.path)));
    expect([...xml.matchAll(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].length).toBe(PAGES.length);
  });

  test("_headers marks every non-public host noindex and never the public site", () => {
    const headers = readFileSync(join(dist, "_headers"), "utf8");
    for (const host of ["https://app.arto.joyorogo.com/*", "https://baroka.by.dzulfikar.com/*"]) expect(headers).toContain(`${host}\n  X-Robots-Tag: noindex`);
    expect(headers).not.toContain(`${SITE_URL}/`);
  });

  test("favicons and manifest icons exist with the sizes they claim", () => {
    const manifest = JSON.parse(readFileSync(join(dist, "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ name: "JoyoArto", lang: "id", start_url: "/", display: "standalone" });
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const file = join(dist, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === "image/png") {
        const [w, h] = icon.sizes.split("x").map(Number);
        expect(pngSize(file)).toEqual({ width: w!, height: h! });
      }
    }
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
    for (const f of ["favicon.ico", "icon.svg", "apple-touch-icon.png"]) expect(existsSync(join(dist, f)), f).toBe(true);
    expect(pngSize(join(dist, "apple-touch-icon.png"))).toEqual({ width: 180, height: 180 });
  });
});
