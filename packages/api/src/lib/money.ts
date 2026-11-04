// Integer minor units everywhere; strings only at the edges (parsing statements, showing amounts).

/** ISO 4217 minor-unit exponents of the currencies we expect; anything else is assumed to have 2. */
const EXPONENTS: Record<string, number> = { IDR: 2, USD: 2, SGD: 2, MYR: 2, EUR: 2, JPY: 0, KRW: 0 };

export function exponentOf(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** 12500 (major) in IDR -> 1250000. Rounds to the nearest minor unit. */
export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** exponentOf(currency));
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** exponentOf(currency);
}

const SYMBOLS: Record<string, string> = { IDR: "Rp", USD: "$", SGD: "S$", MYR: "RM", EUR: "€", JPY: "¥" };

/**
 * Display string in Indonesian notation: "Rp 12.500", "-Rp 1.250.000", "Rp 12.500,50". Decimals are shown only when
 * the amount has a fraction, which for rupiah is almost never.
 */
export function formatMoney(minor: number, currency = "IDR"): string {
  const exp = exponentOf(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = abs % 10 ** exp;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = frac > 0 ? `${grouped},${frac.toString().padStart(exp, "0")}` : grouped;
  const symbol = SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
  return `${negative ? "-" : ""}${symbol} ${body}`;
}

export type DecimalStyle = "dot" | "comma";

/**
 * Parses an amount as statements print it, into minor units. Handles "1,250,000.00" (decimal dot), "1.250.000,00"
 * (decimal comma), "Rp 12.500", "(12,500.00)" and trailing "-"/"DB"/"CR" markers.
 *
 * `decimal` says which character separates decimals. When it is left out it is guessed from the string: the last
 * separator followed by exactly one or two digits is the decimal one; otherwise the number is whole. Throws on
 * anything that is not a number.
 */
export function parseAmount(raw: string, currency = "IDR", decimal?: DecimalStyle): number {
  let s = raw.trim();
  if (!s) throw new Error(`Empty amount`);
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const marker = /\s*(DB|D|CR|C|K)$/i.exec(s);
  if (marker) {
    if (/^D/i.test(marker[1]!)) negative = true;
    s = s.slice(0, marker.index);
  }
  s = s.replace(/^(IDR|Rp\.?)\s*/i, "").replace(/\s+/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^(IDR|Rp\.?)/i, "");
  if (!/^[\d.,]+$/.test(s)) throw new Error(`Not an amount: "${raw}"`);

  let decimalChar: "." | "," | null;
  if (decimal) decimalChar = decimal === "dot" ? "." : ",";
  else {
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    const tail = last >= 0 ? s.slice(last + 1) : "";
    const sepCount = (s.match(/[.,]/g) ?? []).length;
    const sameSep = last >= 0 && (s.match(new RegExp(`\\${s[last]}`, "g")) ?? []).length === sepCount;
    // "12.500" and "1.250.000" are thousands in Indonesian notation; "12.50" and "1,250,000.00" carry decimals.
    decimalChar = last >= 0 && (tail.length === 1 || tail.length === 2) && !(sameSep && sepCount > 1) ? (s[last] as "." | ",") : null;
  }
  let intPart = s;
  let fracPart = "";
  if (decimalChar) {
    const at = s.lastIndexOf(decimalChar);
    if (at >= 0) {
      intPart = s.slice(0, at);
      fracPart = s.slice(at + 1);
    }
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(fracPart) || (!intPart && !fracPart)) throw new Error(`Not an amount: "${raw}"`);
  const exp = exponentOf(currency);
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  const minor = Number(intPart || "0") * 10 ** exp + Number(frac || "0");
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: "${raw}"`);
  return negative ? -minor : minor;
}
