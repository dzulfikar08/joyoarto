/**
 * Cross-site request check for /rpc and /api/* (better-auth's /api/auth/* checks origins itself and is answered before
 * this runs). A request that changes something and is authenticated by the session cookie must come from one of our
 * own origins: the OpenAPI handler accepts form-urlencoded and multipart bodies, so a plain cross-site form could
 * otherwise act as the signed-in member. Requests with an Authorization header (the phone app's session bearer,
 * `brk_` tokens) carry no ambient credential, and requests without a cookie have nothing to borrow; both pass.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isProtectedPath(path: string): boolean {
  return path.startsWith("/rpc") || path.startsWith("/api/");
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** True when the request may go on; `allowed` lists trusted origins (scheme://host[:port]). */
export function passesCsrfCheck(request: Request, allowed: readonly string[]): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  if (request.headers.get("authorization")) return true;
  if (!request.headers.get("cookie")) return true;

  const trusted = new Set([new URL(request.url).origin, ...allowed.map(originOf).filter((o): o is string => !!o)]);
  const origin = request.headers.get("origin");
  // Origin is sent on every cross-site POST by current browsers; "null" (sandboxed frames, some redirects) is refused.
  if (origin !== null) return origin !== "null" && trusted.has(origin);
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const referer = originOf(request.headers.get("referer"));
  return referer !== null && trusted.has(referer);
}
