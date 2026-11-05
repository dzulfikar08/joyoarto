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

/** Whether `a` and `b` are the same domain or one is a subdomain of the other (DMARC-style relaxed alignment). */
function aligned(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/\.$/, "");
  const y = b.toLowerCase().replace(/\.$/, "");
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
}

/**
 * Whether the receiving server (Cloudflare Email Routing, authserv-id mx.cloudflare.net) authenticated the sender's
 * domain: SPF for the envelope domain, DKIM for it, or DMARC for a From domain aligned with it.
 *
 * Only the topmost Authentication-Results / ARC-Authentication-Results header is read: Cloudflare prepends its own
 * (as `ARC-Authentication-Results: i=N; mx.cloudflare.net; ...`), so anything below it came with the message and
 * can be forged by the sender. That header must name mx.cloudflare.net as its authserv-id, else "unknown".
 */
export function senderAuth(headers: { key: string; value: string }[], envelopeFrom: string): SenderAuth {
  const domain = envelopeFrom.toLowerCase().split("@")[1] ?? "";
  const top = headers.find((h) => h.key === "authentication-results" || h.key === "arc-authentication-results");
  if (!top) return "unknown";
  // authserv-id: the first ;-separated field, after the "i=N" instance tag on ARC headers.
  const fields = top.value.replace(/\s+/g, " ").split(";").map((f) => f.trim());
  if (top.key === "arc-authentication-results" && /^i=\d+$/i.test(fields[0] ?? "")) fields.shift();
  const authservId = (fields.shift() ?? "").split(" ")[0]!.toLowerCase();
  if (authservId !== "mx.cloudflare.net" || !domain) return "unknown";
  const parentOrSame = (d: string | undefined) => !!d && (d.toLowerCase() === domain || domain.endsWith(`.${d.toLowerCase()}`));
  for (const r of fields) {
    const dmarc = /^dmarc=pass\b.*?\bheader\.from=([^\s;]+)/i.exec(r);
    if (dmarc && aligned(dmarc[1]!, domain)) return "pass";
    const spf = /^spf=pass\b.*?\bsmtp\.mailfrom=(?:[^@\s;]*@)?([^\s;]+)/i.exec(r);
    if (spf && parentOrSame(spf[1])) return "pass";
    const dkim = /^dkim=pass\b.*?\bheader\.(?:d|i)=@?([^\s;]+)/i.exec(r);
    if (dkim && parentOrSame(dkim[1])) return "pass";
  }
  return "fail";
}
