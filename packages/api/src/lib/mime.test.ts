import { describe, expect, test } from "bun:test";

import { cfAuth } from "../test/email";
import { senderAuth } from "./mime";

/** Headers as postal-mime gives them (lower-case keys, top of the message first), from raw "Key: value" lines. */
const parse = (...lines: string[]) =>
  lines.map((l) => {
    const i = l.indexOf(": ");
    return { key: l.slice(0, i).toLowerCase(), value: l.slice(i + 2) };
  });

describe("senderAuth bypasses", () => {
  test("DMARC pass for a From domain unrelated to the envelope does not count", () => {
    const h = parse("ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=evil.com; dmarc=pass header.from=evil.com; spf=fail smtp.mailfrom=rina@b.com");
    expect(senderAuth(h, "rina@b.com")).toBe("fail");
    // DMARC pass without header.from says nothing about which domain passed.
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dmarc=pass"), "rina@b.com")).toBe("fail");
  });

  test("DMARC pass aligned with the envelope domain counts (subdomain either way)", () => {
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=b.com"), "rina@b.com")).toBe("pass");
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=b.com"), "bounce@mail.b.com")).toBe("pass");
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=news.b.com"), "rina@b.com")).toBe("pass");
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=notb.com"), "rina@b.com")).toBe("fail");
  });

  test("a forged mx.cloudflare.net result below Cloudflare's own is ignored", () => {
    const h = parse(cfAuth("rina@b.com", false), "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=rina@b.com; dkim=pass header.d=b.com");
    expect(senderAuth(h, "rina@b.com")).toBe("fail");
  });

  test("a header that only mentions mx.cloudflare.net somewhere is not Cloudflare's", () => {
    const h = parse("Authentication-Results: mx.evil.com; spf=pass (mx.cloudflare.net) smtp.mailfrom=rina@b.com");
    expect(senderAuth(h, "rina@b.com")).toBe("unknown");
    const top = parse("ARC-Authentication-Results: i=1; mx.google.com; spf=pass smtp.mailfrom=rina@b.com", cfAuth("rina@b.com"));
    expect(senderAuth(top, "rina@b.com")).toBe("unknown");
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net.evil.com; spf=pass smtp.mailfrom=rina@b.com"), "rina@b.com")).toBe("unknown");
  });

  test("Cloudflare's real result shape still passes, ARC and plain", () => {
    expect(senderAuth(parse(cfAuth("rina@b.com"), "Received: from x"), "rina@b.com")).toBe("pass");
    expect(senderAuth(parse("Authentication-Results: mx.cloudflare.net; dkim=pass header.d=b.com header.s=s1"), "rina@b.com")).toBe("pass");
  });

  test("Gmail auto-forward: SPF pass for gmail.com, DMARC for the original sender's domain", () => {
    const from = "rina+caf_=import+tok=arto.joyorogo.com@gmail.com";
    const h = parse(
      `ARC-Authentication-Results: i=2; mx.cloudflare.net; dkim=pass header.d=bank.co.id header.s=s1; dmarc=pass header.from=bank.co.id policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of ${from} designates 209.85.0.1 as permitted sender) smtp.mailfrom=${from}; arc=pass`,
      "ARC-Authentication-Results: i=1; mx.google.com; dkim=pass header.i=@bank.co.id",
    );
    expect(senderAuth(h, from)).toBe("pass");
  });
});
