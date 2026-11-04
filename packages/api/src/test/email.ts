// Test helpers for the email import: a raw MIME message with attachments, and a long Bank Jago statement.

const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
};

export function rawEmail(input: {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  attachments?: { name: string; type?: string; content: Uint8Array }[];
  headers?: string[];
}): string {
  const boundary = `b-${crypto.randomUUID()}`;
  const head = [
    ...(input.headers ?? []),
    `From: <${input.from}>`,
    `To: <${input.to}>`,
    `Subject: ${input.subject ?? "Statement"}`,
    `Message-ID: <${crypto.randomUUID()}@example.com>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.text ?? "See attached."}\r\n`,
    ...(input.attachments ?? []).map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.type ?? "application/pdf"}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.content)}\r\n`,
    ),
  ];
  return `${head.join("\r\n")}\r\n\r\n${parts.join("")}--${boundary}--\r\n`;
}

/** Cloudflare's authentication result for a sender that passed SPF/DKIM/DMARC (or failed, with `ok` false). */
export function cfAuth(from: string, ok = true): string {
  const domain = from.split("@")[1];
  const r = ok ? "pass" : "fail";
  return `ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=${r} header.d=${domain} header.s=s1 header.b=abc; dmarc=${r} header.from=${domain} policy.dmarc=none; spf=${r} (mx.cloudflare.net: domain of ${from} designates 1.2.3.4 as permitted sender) smtp.mailfrom=${from}`;
}

const idr = (minor: number) => `${Math.floor(Math.abs(minor) / 100).toLocaleString("de-DE")},${String(Math.abs(minor) % 100).padStart(2, "0")}`;

/** A one-pocket Bank Jago statement with `rows` transactions (layout of lib/statements/sample.ts), balances correct. */
export function longJagoText(rows: number): string {
  const previous = 50_000_000_00;
  const amounts = Array.from({ length: rows }, (_, i) => (i % 5 === 0 ? 1_000_000_00 + i * 100 : -(15_000_00 + i * 100)));
  const inc = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
  const out = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
  const lines = [
    "Monthly Statements September 2026 Page 1 of 9",
    "PT Bank Jago Tbk is licensed and supervised by Financial Services Authority (OJK)",
    "RINA PRATAMA / 500000007777",
    "Main Pocket",
    "Pocket ID 500000007777",
    "Previous Balance",
    "Total Incoming",
    "Total Outgoing",
    "Closing Balance",
    idr(previous),
    `+${idr(inc)}`,
    `-${idr(out)}`,
    idr(previous + inc - out),
    "Date & Time Source/Destination Transaction Details Notes Amount Balance",
  ];
  let balance = previous;
  amounts.forEach((a, i) => {
    balance += a;
    const day = String(1 + Math.floor((i * 29) / rows)).padStart(2, "0");
    const ref = `2609${day}-7777-${String(i + 1).padStart(6, "0")}`;
    const source = a > 0 ? [`PT KLIEN ${i}`, "BCA 8830012345"] : [`TOKO NOMOR ${i}`, "BRI 0012345678901"];
    lines.push(`${day} Sep 2026`, "10:00", ...source, a > 0 ? "Incoming Transfer" : "Outgoing Transfer", `ID# ${ref}`, `${a < 0 ? "-" : "+"}${idr(a)} ${idr(balance)}`);
  });
  return lines.join("\n");
}
