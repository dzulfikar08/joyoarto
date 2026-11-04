import type { CaptureKind, Direction, NotificationInput, ParseResult } from "./types";

// Shared building blocks: amounts, direction words, counterparty extraction, and what is never a transaction.

/** "Rp25.000", "Rp 1.250.000,00", "IDR 25,000.00", "Rp15rb", "Rp1,5jt". */
const AMOUNT = /(?:Rp\.?|IDR)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s?(?:rb|ribu|jt|juta|k)\b)?/gi;

export type FoundAmount = { text: string; minor: number; index: number };

/** Every Rp/IDR amount in the text, in order. */
export function findAmounts(text: string): FoundAmount[] {
  const out: FoundAmount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const minor = amountToMinor(m[1]!, m[2]?.trim());
    if (minor !== null && minor > 0) out.push({ text: m[0].trim(), minor, index: m.index });
  }
  return out;
}

/** "25.000" → 2500000; "1.250.000,50" → 125000050; "25,000.00" → 2500000; "1,5" + "jt" → 150000000. */
export function amountToMinor(num: string, suffix?: string): number | null {
  let major: number;
  if (suffix) {
    const mult = /^(rb|ribu|k)$/i.test(suffix) ? 1e3 : 1e6;
    const parts = num.split(/[.,]/);
    major =
      parts.length === 2 && parts[1]!.length !== 3 ? Number(`${parts[0]}.${parts[1]}`) * mult : Number(parts.join("")) * mult;
  } else {
    // The last separator followed by 1-2 digits is the decimal mark; the others group thousands.
    const dec = /[.,](\d{1,2})$/.exec(num);
    const whole = (dec ? num.slice(0, dec.index) : num).replace(/[.,]/g, "");
    major = Number(whole) + (dec ? Number(dec[1]!.padEnd(2, "0")) / 100 : 0);
  }
  if (!Number.isFinite(major)) return null;
  return Math.round(major * 100);
}

const NOT_A_TRANSACTION: [RegExp, string][] = [
  [/\b(OTP|kode verifikasi|kode rahasia|verification code)\b/i, "verification code"],
  [/\b(gagal|dibatalkan|ditolak|failed|declined|tidak berhasil)\b/i, "failed or cancelled"],
  [/\b(menunggu pembayaran|segera bayar|jatuh tempo|tagihan .* akan)\b/i, "reminder, not a payment"],
  [/\bcashback\b/i, "cashback"],
  [/\b(promo|diskon|voucher|hemat|gratis ongkir|s\.?d\.?|hingga|up to|maks\.?)\b/i, "promotion"],
];

/** A reason when the text is clearly not a completed transaction. Promo words only count without a success word. */
export function notATransaction(text: string): string | null {
  const done = /\b(berhasil|sukses|diterima|masuk|terkirim|telah dibayar|udah dikirim|sudah dikirim)\b/i.test(text);
  for (const [re, why] of NOT_A_TRANSACTION) {
    if (!re.test(text)) continue;
    if (why === "promotion" && done) continue;
    return why;
  }
  return null;
}

const IN_WORDS = /\b(menerima|diterima|uang masuk|dana masuk|masuk ke|bertambah|refund|dikembalikan|pengembalian|top ?up berhasil|kamu dapat transfer|received)\b/i;
const OUT_WORDS = /\b(pembayaran|bayar|dibayar|dibayarkan|transfer|kirim uang|dikirim|terkirim|mengirim|autodebit|auto debit|tarik tunai|pembelian|belanja|terpotong|debit|paid)\b/i;

export function directionOf(text: string): Direction | null {
  const i = IN_WORDS.exec(text)?.index ?? -1;
  const o = OUT_WORDS.exec(text)?.index ?? -1;
  if (i >= 0 && o < 0) return "in";
  if (o >= 0 && i < 0) return "out";
  if (i >= 0 && o >= 0) return i < o ? "in" : "out";
  return null;
}

export function kindOf(text: string, direction: Direction): CaptureKind {
  if (/\b(refund|dikembalikan|pengembalian)\b/i.test(text)) return "refund";
  if (/\btop ?up\b/i.test(text)) return "topup";
  if (/\btarik tunai\b/i.test(text)) return "withdrawal";
  if (direction === "in") return "incoming";
  if (/\b(transfer|kirim|dikirim|terkirim|mengirim)\b/i.test(text)) return "transfer";
  return "payment";
}

/** Words that end a name: "Pembayaran ke KOPI KENANGAN berhasil", "... dari BUDI ke Kantong Utama". */
const NAME_END =
  /\s+(?:berhasil|sukses|sebesar|senilai|dari|ke|via|pakai|menggunakan|dengan|telah|sudah|udah|pada|tanggal|tgl|untuk|di|Rp\.?|IDR)\b|\s*[(.,!;:\n]|\s+-\s|$/i;

function cleanName(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim().replace(/^["'“]|["'”]$/g, "");
  if (s.length < 2 || s.length > 60) return null;
  if (/^(rp|idr|kamu|anda|saldo|rekening|akun)\b/i.test(s)) return null;
  return s;
}

/** The name right after one of the lead-in patterns, cut at the first NAME_END. */
function nameAfter(text: string, lead: RegExp): string | null {
  const m = lead.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = NAME_END.exec(rest);
  return cleanName(end ? rest.slice(0, end.index) : rest);
}

export function counterpartyOf(text: string, direction: Direction): string | null {
  const leads =
    direction === "in"
      ? [/\b(?:dari|from)\s+/i, /\b(?:refund|pengembalian)\s+(?:dana\s+)?(?:dari\s+)?/i]
      : [
          /\b(?:pembayaran|bayar|transfer|kirim(?: uang)?|dikirim|terkirim|dibayarkan|mengirim)\b(?:\s+(?:QRIS|uang))?(?:\s+(?:Rp|IDR)\.?\s?[\d.,]+\s?(?:rb|jt|k)?)?\s+(?:ke|kepada|di|to)\s+/i,
          /\b(?:ke|kepada)\s+/i,
          /\b(?:di|at)\s+/i,
          /\b(?:untuk)\s+/i,
        ];
  for (const lead of leads) {
    const name = nameAfter(text, lead);
    if (name && !/^(kantong|rekening|saldo|gopay kamu|akun)\b/i.test(name)) return name;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

/**
 * A date/time printed in the text, read as WIB (UTC+7): "04/11/2026 10:21", "4 Nov 2026 10:21", "04-11-2026".
 * Falls back to when the notification was posted.
 */
export function occurredAtOf(text: string, postedAt: number): string {
  let y: number | undefined, mo: number | undefined, d: number | undefined;
  const num = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  const named = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b/.exec(text);
  if (num) [d, mo, y] = [Number(num[1]), Number(num[2]), Number(num[3])];
  else if (named && MONTHS[named[2]!.toLowerCase()]) [d, mo, y] = [Number(named[1]), MONTHS[named[2]!.toLowerCase()], Number(named[3])];
  if (!y || !mo || !d || mo > 12 || d > 31) return new Date(postedAt).toISOString();
  const time = /\b(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(?:WIB)?\b/.exec(text.slice((num ?? named)!.index));
  const [hh, mm] = time ? [Number(time[1]), Number(time[2])] : [12, 0];
  const iso = new Date(Date.UTC(y, mo - 1, d, hh - 7, mm));
  // A printed date far from the post time is more likely a due date or a typo than the transaction.
  if (Number.isNaN(iso.getTime()) || Math.abs(iso.getTime() - postedAt) > 3 * 86_400_000) return new Date(postedAt).toISOString();
  return iso.toISOString();
}

/** The shared core: given a source label and its success patterns, build a ParseResult. */
export function parseWith(
  n: NotificationInput,
  source: "jago" | "gopay" | "other",
  opts: { known: RegExp[]; ignore?: [RegExp, string][] },
): ParseResult {
  const text = `${n.title}. ${n.text}`.replace(/\s+/g, " ").trim();
  for (const [re, why] of opts.ignore ?? []) if (re.test(text)) return { ok: false, ignored: why };
  const not = notATransaction(text);
  if (not) return { ok: false, ignored: not };
  const amounts = findAmounts(text);
  if (!amounts.length) return { ok: false, ignored: "no amount" };

  const doubts: string[] = [];
  const known = opts.known.some((re) => re.test(text));
  if (!known) doubts.push("unfamiliar wording");
  const distinct = [...new Set(amounts.map((a) => a.minor))];
  // With several amounts (fee, balance), the first is the transaction in every format seen so far.
  if (distinct.length > 1 && !/\b(biaya|admin|saldo)\b/i.test(text)) doubts.push("several amounts");
  const amount = amounts[0]!;
  let direction = directionOf(text);
  if (!direction) {
    doubts.push("direction unclear");
    direction = "out";
  }
  const counterparty = counterpartyOf(text, direction);
  if (!counterparty) doubts.push("no merchant or name");
  return {
    ok: true,
    capture: {
      source,
      kind: kindOf(text, direction),
      direction,
      amountText: amount.text,
      amountMinor: amount.minor,
      counterparty,
      occurredAt: occurredAtOf(text, n.postedAt),
      confidence: doubts.length ? "low" : "high",
      doubts,
    },
  };
}
