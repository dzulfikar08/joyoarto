// Statement PDFs shared to the installed app (Android: Share → JoyoArto). public/sw.js parks them in this cache and
// redirects to /import; the import page takes them out here, once.

const SHARE_CACHE = "baroka-share-v1";
/** Shares older than this were never picked up (signed out, closed the app); they are dropped, not shown. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let inflight: Promise<File[]> | null = null;

/**
 * The files waiting from a share, oldest share first; they are removed from the cache as they are read. Calls while
 * one is running get the same promise (React runs a mount effect twice in development).
 */
export function takeSharedFiles(): Promise<File[]> {
  inflight ??= readShared().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readShared(): Promise<File[]> {
  if (typeof caches === "undefined" || !(await caches.has(SHARE_CACHE))) return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  const keys = [...(await cache.keys())].sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
  for (const req of keys) {
    const res = await cache.match(req);
    await cache.delete(req);
    if (!res) continue;
    if (Date.now() - Number(res.headers.get("x-shared-at") ?? 0) > MAX_AGE_MS) continue;
    const name = decodeURIComponent(res.headers.get("x-file-name") ?? "statement.pdf");
    files.push(new File([await res.blob()], name, { type: res.headers.get("content-type") ?? "application/pdf" }));
  }
  return files;
}

/** Registers public/sw.js (share target only). Safe to call on every load. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
