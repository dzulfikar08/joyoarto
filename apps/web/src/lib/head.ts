// Keeps <head> in step with client-side navigation between public pages. The first load already has the right tags
// (scripts/prerender.ts writes them per page); this only matters after the router changes page without a reload.

import { LANDING_HOST, OG_SIZE, SITE_NAME, pageFor, url, ogPath } from "./seo";

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

let notFound = false;

/** The 404 page is showing (set by components/not-found.tsx, which renders before the root's effect runs). */
export function setNotFound(on: boolean) {
  notFound = on;
  if (on) syncHead(location.pathname);
}

/** Title, description, canonical, robots and share tags for `pathname`; app pages get a plain title and noindex. */
export function syncHead(pathname: string) {
  if (typeof document === "undefined") return;
  const page = notFound ? undefined : pageFor(pathname);
  const indexable = !!page && location.hostname === LANDING_HOST;
  setMeta("name", "robots", indexable ? "index, follow, max-image-preview:large" : "noindex");
  if (!page) {
    document.title = notFound ? `Halaman tidak ditemukan · ${SITE_NAME}` : SITE_NAME;
    return;
  }
  const social = page.social ?? { title: page.title, description: page.description };
  const image = url(ogPath(page.og));
  document.title = page.title;
  setMeta("name", "description", page.description);
  setCanonical(url(page.path));
  setMeta("property", "og:url", url(page.path));
  setMeta("property", "og:title", social.title);
  setMeta("property", "og:description", social.description);
  setMeta("property", "og:image", image);
  setMeta("property", "og:image:alt", page.og.alt);
  setMeta("property", "og:image:width", String(OG_SIZE.width));
  setMeta("property", "og:image:height", String(OG_SIZE.height));
  setMeta("name", "twitter:title", social.title);
  setMeta("name", "twitter:description", social.description);
  setMeta("name", "twitter:image", image);
}
