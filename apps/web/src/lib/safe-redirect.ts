/** Only same-origin paths: an open redirect would let a link send someone elsewhere after signing in. */
export function safeRedirect(target: string | undefined, origin = typeof location === "undefined" ? "http://localhost" : location.origin): string {
  // Browsers read "\" as "/", so "/\evil.com" would leave the site; the URL parser also drops tabs and newlines.
  if (!target || !target.startsWith("/") || target.startsWith("//") || /[\\\u0000-\u001f]/.test(target)) return "/";
  try {
    const url = new URL(target, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
