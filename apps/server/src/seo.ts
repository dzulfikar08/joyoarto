// Search engines and security researchers: robots.txt per host, /.well-known/security.txt, and X-Robots-Tag on every
// response this Worker makes itself (static pages get theirs from apps/web/public/_headers).
import type { Hono } from "hono";

/** The public site, the only host that should be indexed (apps/web/src/lib/brand.ts SITE_URL). */
export const LANDING_HOST = "arto.joyorogo.com";
/** apps/web/src/lib/brand.ts CONTACT_EMAIL (a web test keeps the two equal). */
export const SECURITY_CONTACT = "support@joyorogo.com";

export function robotsTxt(host: string): string {
  if (host === LANDING_HOST) {
    return ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /rpc/", "Disallow: /mcp", "", `Sitemap: https://${LANDING_HOST}/sitemap.xml`, ""].join("\n");
  }
  // The app (and the old host): every page answers X-Robots-Tag: noindex. Crawling stays allowed so search engines
  // can read that and drop the pages; "Disallow: /" would hide the noindex and keep already-listed URLs around.
  return ["# The signed-in app. Not for search results: every page is noindex.", "User-agent: *", "Disallow: /api/", "Disallow: /rpc/", "Disallow: /mcp", ""].join("\n");
}

/** RFC 9116. Expires is always about six months ahead, so the file never goes stale. */
export function securityTxt(now = new Date()): string {
  const expires = new Date(now.getTime() + 182 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: mailto:${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: id, en",
    `Canonical: https://${LANDING_HOST}/.well-known/security.txt`,
    "Policy: https://github.com/dzulfikar08/joyoarto/security",
    "",
  ].join("\n");
}

export function registerSeoRoutes(app: Hono) {
  // Everything the Worker answers itself (API, MCP, auth, OAuth metadata) stays out of search results.
  app.use("*", async (c, next) => {
    await next();
    try {
      c.res.headers.set("X-Robots-Tag", "noindex");
    } catch {
      // Immutable headers (e.g. Response.redirect): copy the response first.
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set("X-Robots-Tag", "noindex");
    }
  });
  app.get("/robots.txt", (c) => c.text(robotsTxt(new URL(c.req.url).hostname), 200, { "Cache-Control": "public, max-age=3600" }));
  app.get("/.well-known/security.txt", (c) => c.text(securityTxt(), 200, { "Cache-Control": "public, max-age=86400" }));
}
