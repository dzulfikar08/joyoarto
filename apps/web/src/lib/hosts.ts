import { APP_ORIGIN } from "./brand";

/** Pages the public site (arto.joyorogo.com) shows itself; every other path belongs to the app host. */
export const PUBLIC_PATHS = ["/", "/demo", "/pricing", "/claude", "/privasi", "/syarat", "/support"];
const LANDING_HOST = "arto.joyorogo.com";
const OLD_HOST = "baroka.by.dzulfikar.com";

/** Where this page should live instead, or null when this host serves it. Mirrors the inline script in index.html. */
export function hostRedirect(hostname: string, pathname: string, rest = ""): string | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (hostname === OLD_HOST || (hostname === LANDING_HOST && !PUBLIC_PATHS.includes(path))) return APP_ORIGIN + pathname + rest;
  return null;
}
