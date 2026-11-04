// JoyoArto service worker. It does one thing: receive statement PDFs shared from another app (the manifest's
// share_target POSTs them to /share-target), park them in the Cache API and send the page to /import, which loads them
// into the bulk preview (src/lib/shared-files.ts). No offline caching: every other request goes to the network as usual.

const SHARE_CACHE = "baroka-share-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith(receiveShare(event.request));
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("statements").filter((f) => typeof f !== "string");
    const cache = await caches.open(SHARE_CACHE);
    const batch = Date.now();
    await Promise.all(
      files.map((file, i) =>
        cache.put(
          `/shared/${batch}/${i}`,
          new Response(file, {
            headers: {
              "content-type": file.type || "application/pdf",
              "x-file-name": encodeURIComponent(file.name || `statement-${i + 1}.pdf`),
              "x-shared-at": String(batch),
            },
          }),
        ),
      ),
    );
    return Response.redirect(files.length ? "/import?shared=1" : "/import?shared=none", 303);
  } catch {
    return Response.redirect("/import?shared=failed", 303);
  }
}
