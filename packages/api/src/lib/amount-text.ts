// Amounts as people type or say them, and as bank/e-wallet notifications print them: "25rb", "Rp 25.000", "1,5jt",
// "IDR 1,250,000.00", "+500k". Pure, so the web app can show what it understood before sending.

import { exponentOf, parseAmount } from "./money";

/** Indonesian (and English) shorthand multipliers. "M" is miliar (case-sensitive: a lone "m" is ambiguous). */
const SUFFIXES: [RegExp, number][] = [
  [/^(rb|ribu|rbu|k|K|rebu)$/, 1e3],
  [/^(jt|juta|jeti|mio|mn)$/i, 1e6],
  [/^(M|miliar|milyar|b|bn)$/, 1e9],
];

export type ParsedAmountText = {
  /** Absolute value, minor units. */
  amount: number;
  /** -1 when the text says money out ("-25rb", "25rb DB"), 1 when it says in ("+25rb", "CR"), else null. */
  sign: -1 | 1 | null;
};

/**
 * Parses one amount, the whole string. Throws when it is not an amount. With a suffix, "1,5" and "1.5" are decimals
 * and "1.250rb" is 1.250 thousand; without one, separators follow parseAmount (Indonesian "25.000" is whole).
 */
export function parseAmountText(raw: string, currency = "IDR"): ParsedAmountText {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) throw new Error("Empty amount");
  let sign: -1 | 1 | null = null;
  const lead = /^([+\-−])\s*/.exec(s);
  if (lead) {
    sign = lead[1] === "+" ? 1 : -1;
    s = s.slice(lead[0].length);
  }
  // Statement markers; a bare "K" is thousands ("25K"), never kredit.
  const marker = /\s*\b(DB|CR)$/i.exec(s);
  if (marker) {
    sign = marker[1]!.toUpperCase() === "DB" ? -1 : 1;
    s = s.slice(0, marker.index);
  }
  s = s.replace(/^(IDR|Rp\.?)\s*/i, "").replace(/,-$|\.-$/, "").trim();
  if (sign === null) {
    const inner = /^([+\-−])\s*/.exec(s);
    if (inner) {
      sign = inner[1] === "+" ? 1 : -1;
      s = s.slice(inner[0].length);
    }
  }

  const m = /^(\d+(?:[.,]\d+)*)\s*([a-zA-Z]+)?$/.exec(s);
  if (!m) throw new Error(`Not an amount: "${raw}"`);
  const [, num, suffix] = m as unknown as [string, string, string | undefined];
  const exp = exponentOf(currency);

  if (suffix) {
    const mult = SUFFIXES.find(([re]) => re.test(suffix))?.[1];
    if (!mult) throw new Error(`Unknown unit "${suffix}" in "${raw}"`);
    const parts = num.split(/[.,]/);
    let major: number;
    if (parts.length === 1) major = Number(parts[0]);
    else if (parts.length === 2 && parts[1]!.length !== 3) major = Number(`${parts[0]}.${parts[1]}`);
    else if (parts.slice(1).every((p) => p.length === 3)) major = Number(parts.join(""));
    else throw new Error(`Not an amount: "${raw}"`);
    const amount = Math.round(major * mult * 10 ** exp);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Not an amount: "${raw}"`);
    return { amount, sign };
  }

  const amount = Math.abs(parseAmount(num, currency));
  if (!amount) throw new Error(`Amount is zero: "${raw}"`);
  return { amount, sign };
}

const AMOUNT_IN_TEXT =
  /(?:(?:Rp\.?|IDR)\s*([+-]?\s*\d[\d.,]*(?:\s*(?:rb|ribu|jt|juta|k|K|M))?)|([+-]?\d[\d.,]*\s*(?:rb|ribu|jt|juta|k|K)))(?![\w])/i;

/** The first amount in a longer text (a notification body): "Rp" / "IDR" amounts first, then shorthand ("25rb"). */
export function findAmountInText(text: string, currency = "IDR"): ParsedAmountText | null {
  const m = AMOUNT_IN_TEXT.exec(text);
  if (!m) return null;
  try {
    return parseAmountText((m[1] ?? m[2] ?? "").replace(/[.,]$/, ""), currency);
  } catch {
    return null;
  }
}

const INCOMING = /\b(masuk|diterima|menerima|terima|received|credited|incoming|top ?up berhasil|refund|cashback|dana masuk|transfer masuk|kredit)\b/i;
const OUTGOING = /\b(keluar|pembayaran|bayar|dibayar|membayar|paid|payment|purchase|pembelian|debit|debited|transfer ke|kirim|dikirim|spent|tarik)\b/i;

/** Direction a notification describes: 1 in, -1 out, null unclear. */
export function directionInText(text: string): -1 | 1 | null {
  const inc = INCOMING.test(text);
  const out = OUTGOING.test(text);
  if (inc && !out) return 1;
  if (out && !inc) return -1;
  return null;
}

/** Counterparty in a notification: "... di INDOMARET ...", "... ke Budi Santoso ...", "at Starbucks". */
export function counterpartyInText(text: string): string | null {
  const m =
    /\b(?:di|ke|kepada|dari|at|to|from)\s+(?!rp\b|idr\b)([A-Za-z0-9][A-Za-z0-9&'.\- ]{1,48}?)(?=\s+(?:sebesar|senilai|sejumlah|rp|idr|pada|tanggal|tgl|on|berhasil|telah|sudah|via|dengan|menggunakan|pakai|memakai|using|with|for|ke|di|dari|to|at|from)\b|\s*[.,!:;(]|\s*$)/i.exec(
      text,
    );
  const name = m?.[1]?.trim();
  if (!name || /^\d+$/.test(name)) return null;
  return name.slice(0, 80);
}
