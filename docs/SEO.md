# Search and link previews

Only the public site, **https://arto.joyorogo.com** (`/`, `/demo`, `/pricing`, `/claude`, `/privasi`, `/syarat`), is meant for
search results and share previews. The app host (app.arto.joyorogo.com), the old baroka.by.dzulfikar.com and
workers.dev are `noindex`.

| What | Where |
| --- | --- |
| Titles, descriptions, share copy, FAQ, JSON-LD, crawler body | `apps/web/src/lib/seo.ts` (Indonesian; the English toggle has no URL of its own, so no hreflang) |
| Per-page HTML + `sitemap.xml` | `apps/web/scripts/prerender.ts`, run by `vite build` (plugin in `vite.config.ts`). Writes `dist/index.html`, `demo.html`, `pricing.html`, `claude.html`, `privasi.html`, `syarat.html`; Workers assets serve `demo.html` at `/demo`. |
| Head on client-side navigation | `apps/web/src/lib/head.ts` (`syncHead`, called from the root route); 404s: `components/not-found.tsx` (noindex) |
| Share cards (1200×630 PNG) | `apps/web/public/og/*.png` and `public/og.png`, drawn by `bun run og` in apps/web (`scripts/og.ts`: satori + resvg, Plus Jakarta Sans from @fontsource, no network). Checked in; rerun after changing `OG` in seo.ts. |
| `X-Robots-Tag` on static files | `apps/web/public/_headers` (host rules) |
| `X-Robots-Tag` on Worker responses, `robots.txt` per host, `/.well-known/security.txt` | `apps/server/src/seo.ts`; `/robots.txt` is in `run_worker_first` |
| Checks | `apps/web/src/lib/seo.test.ts`, `apps/web/src/lib/prerender.test.ts` (reads `dist/`, CI builds first), `apps/server/src/seo.test.ts`, and the "SEO smoke test" step in `deploy.yml` |

How the prerendered body works: each page's HTML carries a plain `<div id="prerender">` (headline, copy, FAQ, links)
before `<div id="app">`. The inline script in `index.html` adds a `js` class that hides it before first paint, and
`main.tsx` removes it, so people running the app never see it and React renders into `#app` as before. Crawlers and
scrapers that don't run JavaScript read it.

Adding a public page: add it to `PAGES` in seo.ts, `PUBLIC_PATHS` in `src/lib/hosts.ts` and the `pub` list in
`index.html` (a test checks they agree), give it a share card, rerun `bun run og`.

When prices change, update `PRO_MONTHLY_IDR` in seo.ts (structured data only). When the landing FAQ changes, the test
names the FAQ entry to copy into seo.ts.

## After a deploy

1. **Search Console, domain property `joyorogo.com`:** add the property, choose *Domain*, and copy the
   `google-site-verification=…` TXT record into Cloudflare DNS for joyorogo.com (name `@`). Verify. That one
   property covers arto. and app. (app. stays out of results through noindex).
2. **Sitemap:** Search Console → Sitemaps → submit `https://arto.joyorogo.com/sitemap.xml`.
3. **URL Inspection** for `https://arto.joyorogo.com/` → *Request indexing* (then `/demo`, `/pricing`, `/claude`).
4. Optional: Bing Webmaster Tools → *Import from Google Search Console* (also feeds DuckDuckGo/Yahoo).

## Validators

- Google Rich Results Test: https://search.google.com/test/rich-results?url=https://arto.joyorogo.com/ (FAQPage,
  SoftwareApplication; FAQ rich results are only shown for some sites, but the markup should validate). Also run it
  on `/pricing`.
- Schema.org validator: https://validator.schema.org/ (all JSON-LD types, not just Google's).
- opengraph.xyz: https://www.opengraph.xyz/url/https%3A%2F%2Farto.joyorogo.com%2F (and `/demo`, `/pricing`, `/privasi`).
- Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/ (*Scrape Again* after a copy change;
  WhatsApp uses the same cache).
- LinkedIn Post Inspector: https://www.linkedin.com/post-inspector/
- X: paste the URL into a draft post (the card validator was retired).
- Telegram: send the link to @WebpageBot to refresh its cache.
- PageSpeed Insights: https://pagespeed.web.dev/ for `/` (LCP, CLS, font preload).
- From a terminal:
  `curl -sI https://app.arto.joyorogo.com/login | grep -i x-robots` (noindex),
  `curl -sI https://arto.joyorogo.com/ | grep -i x-robots` (nothing),
  `curl -s https://arto.joyorogo.com/robots.txt`, `curl -s https://app.arto.joyorogo.com/robots.txt`,
  `curl -s https://arto.joyorogo.com/.well-known/security.txt`.

Known limits: unknown paths get the SPA fallback (HTTP 200). On arto.joyorogo.com they redirect to the app host, which
shows a noindex 404 page. A real 404 status would need the Worker to run first for every path.
