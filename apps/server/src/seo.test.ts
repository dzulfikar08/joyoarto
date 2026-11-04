import { expect, test } from "bun:test";

import { robotsTxt, securityTxt } from "./seo";

test("robots.txt: the public site lists its sitemap, the app host does not block the noindex from being read", () => {
  expect(robotsTxt("arto.joyorogo.com")).toContain("Sitemap: https://arto.joyorogo.com/sitemap.xml");
  expect(robotsTxt("arto.joyorogo.com")).toContain("Allow: /");
  const app = robotsTxt("app.arto.joyorogo.com");
  expect(app).not.toContain("Sitemap");
  expect(app).not.toMatch(/^Disallow: \/$/m);
});

test("security.txt has a contact and an Expires under a year ahead", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  const txt = securityTxt(now);
  expect(txt).toMatch(/^Contact: mailto:\S+@\S+$/m);
  const expires = new Date(/^Expires: (.+)$/m.exec(txt)![1]!);
  expect(expires.getTime()).toBeGreaterThan(now.getTime());
  expect(expires.getTime() - now.getTime()).toBeLessThan(365 * 86_400_000);
});
