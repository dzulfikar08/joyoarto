// Turns what Indonesian banks print into a merchant name a person recognises. This is a best effort that is only
// used to seed `merchant`: the raw description is always kept, and rules or the user can override the result.

/** Channel and transfer jargon that says how money moved, not to whom. Longest phrases first. */
const NOISE = [
  "TRSF E-BANKING DB",
  "TRSF E-BANKING CR",
  "TRANSFER DR",
  "TRANSFER CR",
  "TRANSFER KE",
  "TRANSFER DARI",
  "TRANSFER",
  "TARIKAN ATM",
  "SETORAN TUNAI",
  "KARTU DEBIT",
  "KARTU KREDIT",
  "DEBIT DOMESTIK",
  "PEMBAYARAN QRIS",
  "QRIS PAYMENT",
  "QR PAYMENT",
  "QRIS",
  "BI-FAST DB",
  "BI-FAST CR",
  "BI-FAST",
  "BIFAST",
  "SWITCHING DB",
  "SWITCHING CR",
  "SWITCHING",
  "MCM INHOUSETRF",
  // BCA channel codes (internet banking, mobile, virtual account, ATM).
  "FTSCY",
  "FTSCU",
  "FTFVA",
  "WSID",
  "KR OTOMATIS",
  "DB OTOMATIS",
  "PEMBELIAN",
  "PEMBAYARAN",
  "PAYMENT",
  "PURCHASE",
  "POS",
  "ATM",
  "TRF",
  "TRSF",
  "DB",
  "CR",
];

/** Well-known merchants: a pattern anywhere in the description gives the canonical name. */
const KNOWN: [RegExp, string][] = [
  [/\bgo-?(jek|ride|car|food|send|mart|pay)\b|\bgojek\b/i, "Gojek"],
  [/\bgrab\b/i, "Grab"],
  [/\bshopee(pay)?\b/i, "Shopee"],
  [/\btokopedia\b|\btokped\b/i, "Tokopedia"],
  [/\blazada\b/i, "Lazada"],
  [/\bindomaret\b/i, "Indomaret"],
  [/\balfa ?mart\b/i, "Alfamart"],
  [/\balfamidi(ku)?\b/i, "Alfamidi"],
  [/\bstarbucks\b/i, "Starbucks"],
  [/\bkopi kenangan\b/i, "Kopi Kenangan"],
  [/\bpln\b/i, "PLN"],
  [/\btelkomsel\b/i, "Telkomsel"],
  [/\bindihome\b/i, "IndiHome"],
  [/\bnetflix\b/i, "Netflix"],
  [/\bspotify\b/i, "Spotify"],
  [/\bapple\.com|\bitunes\b/i, "Apple"],
  [/\bgoogle\b/i, "Google"],
  [/\btraveloka\b/i, "Traveloka"],
  [/\bpertamina\b|\bspbu\b/i, "Pertamina"],
  [/\bovo\b/i, "OVO"],
  [/\bdana\b/i, "DANA"],
  [/\bbpjs\b/i, "BPJS"],
  [/\bbayar kos\b|\bsewa kos\b/i, "Kos"],
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Pt|Cv|Tbk)\b/g, (w) => w.toUpperCase());
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOISE_RE = new RegExp(`(^|\\s)(${NOISE.map(escape).join("|")})(?=\\s|$)`, "gi");

/** The canonical name when the text names a well-known merchant ("Shopee Indonesia" -> "Shopee"), else null. */
export function knownMerchant(text: string): string | null {
  for (const [pattern, name] of KNOWN) if (pattern.test(text)) return name;
  return null;
}

/** "TRSF E-BANKING DB 0303/FTSCY/WS95051 25000.00 INDOMARET CABANG X" -> "Indomaret". Null when nothing is left. */
export function cleanMerchant(description: string): string | null {
  for (const [pattern, name] of KNOWN) if (pattern.test(description)) return name;
  let s = ` ${description} `
    // Dates (0303, 03/03, 03-03-2026), reference codes mixing letters and digits, long numbers, amounts.
    .replace(/\b\d{1,4}[/-]\d{1,2}([/-]\d{2,4})?\b/g, " ")
    .replace(/\//g, " ")
    .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,}\b/gi, " ")
    .replace(/\b\d[\d.,]*\b/g, " ")
    .replace(/[*#:|_\\]+/g, " ");
  for (let i = 0; i < 3; i++) s = s.replace(NOISE_RE, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/^[-/.,\s]+|[-/.,\s]+$/g, "");
  if (s.length < 2) return null;
  return titleCase(s).slice(0, 80);
}

/** The text rules and search compare against: lower case, single spaces. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
