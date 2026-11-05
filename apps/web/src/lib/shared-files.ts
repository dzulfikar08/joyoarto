// Statement PDFs shared to the installed app (Android: Share → JoyoArto). public/sw.js parks them in this cache and
// redirects to /import; the import page takes them out here, once.

const SHARE_CACHE = "baroka-share-v1";
/** Shares older than this were never picked up (signed out, closed the app); they are dropped, not shown. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `failed`: entries that could not be read; they stay in the cache for the next visit. */
export type SharedFiles = { files: File[]; failed: number };

let inflight: Promise<SharedFiles> | null = null;

/**
 * The files waiting from a share, oldest share first. Each entry leaves the cache only after its file was read, so a
 * failed read keeps it for the next visit. Calls while one is running get the same promise (React runs a
 * mount effect twice in development).
 */
export function takeSharedFiles(): Promise<SharedFiles> {
  inflight ??= readShared().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readShared(): Promise<SharedFiles> {
  if (typeof caches === "undefined" || !(await caches.has(SHARE_CACHE))) return { files: [], failed: 0 };
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  let failed = 0;
  const keys = [...(await cache.keys())].sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
  for (const req of keys) {
    try {
      const res = await cache.match(req);
      if (res && Date.now() - Number(res.headers.get("x-shared-at") ?? 0) <= MAX_AGE_MS) {
        const name = decodeURIComponent(res.headers.get("x-file-name") ?? "statement.pdf");
        files.push(new File([await res.blob()], name, { type: res.headers.get("content-type") ?? "application/pdf" }));
      }
      await cache.delete(req);
    } catch {
      failed++;
    }
  }
  return { files, failed };
}

/** Registers public/sw.js (share target only). Safe to call on every load. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
