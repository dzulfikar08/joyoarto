// Email helpers for the import address: envelope address normalisation and the sender authentication Cloudflare
// reports. Pure, so they are unit tested.

/**
 * The mailbox behind an envelope address, for comparing a sender with a member's email: lower-case, without a
 * "+tag" (Gmail's auto-forward sends from `you+caf_=...@gmail.com`), and for Gmail without dots.
 */
export function mailbox(address: string): string {
  const a = address.trim().toLowerCase().replace(/^<|>$/g, "");
  const at = a.lastIndexOf("@");
  if (at < 0) return a;
  let local = a.slice(0, at).split("+")[0]!;
  let domain = a.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export type SenderAuth = "pass" | "fail" | "unknown";

/**
 * Whether the receiving server (Cloudflare Email Routing, authserv-id mx.cloudflare.net) authenticated the sender's
 * domain: SPF for the envelope domain, DKIM for it, or DMARC. "unknown" when no such result header is present.
 */
export function senderAuth(headers: { key: string; value: string }[], envelopeFrom: string): SenderAuth {
  const domain = envelopeFrom.toLowerCase().split("@")[1] ?? "";
  const results = headers
    .filter((h) => h.key === "authentication-results" || h.key === "arc-authentication-results")
    .map((h) => h.value.replace(/\s+/g, " "))
    .filter((v) => /(^|;|\s)mx\.cloudflare\.net\b/i.test(v));
  if (!results.length) return "unknown";
  const sameDomain = (d: string | undefined) => !!d && (d.toLowerCase() === domain || domain.endsWith(`.${d.toLowerCase()}`));
  for (const r of results) {
    if (/\bdmarc=pass\b/i.test(r)) return "pass";
    const spf = /\bspf=pass\b[^;]*?smtp\.mailfrom=(?:[^@\s;]*@)?([^\s;]+)/i.exec(r);
    if (spf && sameDomain(spf[1])) return "pass";
    for (const m of r.matchAll(/\bdkim=pass\b[^;]*?header\.(?:d|i)=@?([^\s;]+)/gi)) if (sameDomain(m[1])) return "pass";
  }
  return "fail";
}
