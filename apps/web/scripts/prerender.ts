// After `vite build`: one HTML file per public page, with that page's <head> (title, description, canonical, Open
// Graph, X card, JSON-LD) and a plain-HTML body, so link previews (WhatsApp, Telegram, X, Facebook, LinkedIn, Slack)
// and crawlers that do not run JavaScript see real content. Runs from the `prerender-public` plugin in vite.config.ts.
//
// Workers static assets (html_handling "auto-trailing-slash") serve dist/demo.html at /demo, and dist/index.html at /
// and, as the single-page-application fallback, at every path without a file. The app is still a client-rendered SPA:
// the body below sits in #prerender, which the inline script hides before first paint and main.tsx removes, so the
// React tree in #app renders exactly as before (no hydration).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PAGES, headTags, url } from "../src/lib/seo";

const HEAD = /<!-- seo:head -->[\s\S]*?<!-- \/seo:head -->/;
const APP = '<div id="app"></div>';

/** Last commit day of a page's sources (YYYY-MM-DD); today when git has nothing (shallow clone, uncommitted). */
function lastmod(webDir: string, sources: string[]): string {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...sources], { cwd: webDir, encoding: "utf8" }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // No git (tarball build): fall through.
  }
  return new Date().toISOString().slice(0, 10);
}

export function prerender(webDir: string, distDir = join(webDir, "dist")) {
  const template = readFileSync(join(distDir, "index.html"), "utf8");
  if (!HEAD.test(template) || !template.includes(APP)) throw new Error("prerender: index.html lost its <!-- seo:head --> block or #app");

  // Preload the hero font (Plus Jakarta Sans, latin, variable): it is only discovered after the CSS otherwise.
  const font = readdirSync(join(distDir, "assets")).find((f) => /^plus-jakarta-sans-latin-wght-normal-.*\.woff2$/.test(f));
  const preload = font ? `\n    <link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />` : "";

  for (const page of PAGES) {
    const html = template
      .replace(HEAD, () => `<!-- seo:head -->\n    ${headTags(page)}${preload}\n    <!-- /seo:head -->`)
      .replace(APP, () => `<div id="prerender">${page.body()}</div>\n    ${APP}`);
    writeFileSync(join(distDir, page.file), html);
  }

  const urls = PAGES.map(
    (p) => `  <url>\n    <loc>${url(p.path)}</loc>\n    <lastmod>${lastmod(webDir, [...p.sources, "src/lib/seo.ts"])}</lastmod>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`,
  );
  writeFileSync(join(distDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
}
