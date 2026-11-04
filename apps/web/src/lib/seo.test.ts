import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONTACT_EMAIL, SITE_URL } from "./brand";
import { PUBLIC_PATHS } from "./hosts";
import { FAQ, OG_CARDS, PAGES, jsonLd, pageFor } from "./seo";

const web = join(import.meta.dir, "../..");
const read = (p: string) => readFileSync(join(web, p), "utf8");

test("the public pages, hosts.ts and index.html's redirect script agree", () => {
  expect(PAGES.map((p): string => p.path).sort()).toEqual([...PUBLIC_PATHS].sort());
  const inline = /pub = (\[[^\]]*\])/.exec(read("index.html"))?.[1];
  expect(JSON.parse(inline!).sort()).toEqual([...PUBLIC_PATHS].sort());
});

test("every page has a title and description of sensible length, and its own canonical file", () => {
  for (const p of PAGES) {
    expect(p.title.length).toBeLessThanOrEqual(70);
    expect(p.description.length).toBeGreaterThanOrEqual(70);
    expect(p.description.length).toBeLessThanOrEqual(170);
    expect(pageFor(p.path)).toBe(p);
    expect(pageFor(`${p.path === "/" ? "" : p.path}/`)).toBe(p);
  }
  expect(new Set(PAGES.map((p) => p.file)).size).toBe(PAGES.length);
  expect(pageFor("/login")).toBeUndefined();
});

test("the FAQ in structured data is the landing page's FAQ, word for word", () => {
  const landing = read("src/routes/-landing.tsx");
  for (const { q, a } of FAQ) {
    expect(landing, `FAQ question changed on the landing page; update FAQ in src/lib/seo.ts: ${q}`).toContain(JSON.stringify(q));
    expect(landing, `FAQ answer changed on the landing page; update FAQ in src/lib/seo.ts: ${q}`).toContain(JSON.stringify(a));
  }
});

test("JSON-LD: organization, website, app with prices, FAQ on the home page", () => {
  const graph = (jsonLd(pageFor("/")!)["@graph"] as Record<string, unknown>[]).map((n) => n["@type"]);
  expect(graph).toEqual(["Organization", "WebSite", "WebPage", "SoftwareApplication", "FAQPage"]);
  const app = (jsonLd(pageFor("/")!)["@graph"] as Record<string, any>[]).find((n) => n["@type"] === "SoftwareApplication")!;
  expect(app.applicationCategory).toBe("FinanceApplication");
  expect(app.aggregateRating).toBeUndefined();
  expect(app.offers.map((o: { price: string }) => o.price)).toEqual(["0", "15000", "29000", "49000"]);
});

test("the server's security.txt contact is brand.ts's, and the server knows the landing host", () => {
  const server = readFileSync(join(web, "../server/src/seo.ts"), "utf8");
  expect(server).toContain(`"${CONTACT_EMAIL}"`);
  expect(server).toContain(`"${new URL(SITE_URL).hostname}"`);
});

test("share cards exist as files, one per page", () => {
  for (const c of OG_CARDS) expect(Bun.file(join(web, "public", c.file)).size).toBeGreaterThan(0);
});
