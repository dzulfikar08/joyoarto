// Merchant and category suggestions for parsed Jago and GoPay rows. Only what the statement itself makes clear;
// household rules (packages/api/src/services/rules.ts) run first and win, and anything unclear stays uncategorized.

import { knownMerchant } from "../merchant";
import type { JagoRow } from "./jago";

export type Suggestion = { merchant: string | null; category: string | null };

const GOPAY_RULES: [RegExp, string | null][] = [
  [/^GoPay top up$/i, "transfer/topup"],
  [/KITABISA|BAZNAS|DOMPET DHUAFA|LAZISMU|INFAQ|SEDEKAH|ZAKAT/i, "giving"],
  [/RENTAL MOTOR|RENTAL MOBIL/i, "transport"],
  [/DISHUB|PARKIR|PARKING/i, "transport/parking-toll"],
  [/^Refund$/i, "income/refund"],
  [/HOSTINGER|DEWABIZ|NETRA RUNTIME|PT XTRA PEMBAYARAN|GOOGLE PLAY|NETFLIX|SPOTIFY|YOUTUBE/i, "subscriptions"],
  [/INDOMARET|ALFAMART|ALFAGIFT|ALFAMIDI|SUPERINDO|\bMART\b|FAI STORE|RUBELAN|\*TOKO|^TOKO |WARUNG MADURA|BUAH|APELICIOUS/i, "food/groceries"],
  [/APOTEK|KLINIK|PRAKTEK DR|\bDR\b|MEDIKA|RUMAH SAKIT|\bRS\b(?! UMM)/i, "health"],
  [/SHOPEE|TOKOPEDIA|TIKTOK|LAZADA|BLIBLI/i, "shopping/online"],
  [/MDS MALANG|MATAHARI|UNIQLO/i, "shopping/clothing"],
  [/MI STORE|CELL\b|ERAFONE|IBOX/i, "shopping/electronics"],
  [/HOUSEWARE|INFORMA|ACE HARDWARE|IKEA/i, "home"],
  [/ACCESS BY KAI|KAI\b|EXPRESS|TRANSPORTASI|TRAVEL/i, "transport/public"],
  [/GRAB TRANSPORT|TIP KE DRIVER|^RUMAH |^JL\.|^KPPN|JUNCTION$|^PASAR /i, "transport/ride-hailing"],
  [/PERTASHOP|PERTAMINA|SPBU|SHELL /i, "transport/fuel"],
  [/CINEMA|CINEMAXX|MOVIMAX|XXI|CGV|LOKET PARK/i, "entertainment"],
  [/PARK|PARKIR/i, "transport/parking-toll"],
  [/AHASS|CARWASH|BENGKEL/i, "transport"],
  [/^IOH$|INDOSAT|TELKOMSEL|XL AXIATA/i, "bills/phone-internet"],
  [/BARBER|KOSMETIK|SALON/i, "personal-care"],
  [/KOPI|COFFEE|COFFE |COFF|KAFFE|SEDUH|ROBUSTO|CAFE|STARBUCKS|TOMORO|FORE |KENANGAN|-HO$/i, "food/coffee"],
  [/GOSEND/i, "other"],
  [/^GoTagihan$/i, null],
];

/** A merchant as GoPay names it, made readable: "AADK COFFEE TLOGOMAS-HO" -> "Aadk Coffee Tlogomas". */
export function cleanGopayName(name: string): string {
  const known = knownMerchant(name);
  if (known) return known;
  const n = name
    .replace(/\s*-\s*QRIS$|\s+QR(IS)? B[NR]I.*$|\s*-HO$|,\s*(LWKWR|KRMBNGN|KDNGKN)$|\s+1 1$|^QR /i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[ ,.]+$/, "");
  return (n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : n).slice(0, 80);
}

/** Category for a GoPay merchant; most remaining merchants are warungs and restaurants. */
export function gopayCategory(name: string): string | null {
  for (const [pattern, category] of GOPAY_RULES) if (pattern.test(name)) return category;
  return "food/dining";
}

function title(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Suggestion for one Jago row. `owner` is the account holder's name as the statement prints it, so transfers to and
 * from their own accounts and e-wallets are recognised as transfers.
 */
export function classifyJago(r: JagoRow, owner: string | null): Suggestion {
  const src = r.source.join(" ");
  const text = `${src} ${r.kind} ${r.notes.join(" ")}`.toUpperCase();
  const own = owner !== null && src.toUpperCase().startsWith(owner.toUpperCase());
  const counterpart = r.source.filter((s) => !/\d{6,}|^\d$/.test(s)).join(" ").trim();

  if (["Pocket Money In", "Pocket Money Out", "Pockets", "Movement between Pockets"].includes(r.kind)) {
    return { merchant: `Jago pocket: ${r.source[0] ?? "pocket"}`, category: "transfer" };
  }
  if (r.kind === "Top Up Wallet") {
    const wallet = /ShopeePay|GoPay|OVO|DANA/i.exec(src)?.[0] ?? "e-wallet";
    return own ? { merchant: `${wallet} top-up`, category: "transfer/topup" } : { merchant: `${title(r.source[0] ?? "")} (${wallet})`, category: null };
  }
  if (r.kind === "Deposit from GoPay") return { merchant: "GoPay withdrawal", category: "transfer" };
  if ((r.kind === "Outgoing Transfer" || r.kind === "Incoming Transfer") && own) {
    return { merchant: `Own account (${(r.source[1] ?? "").split(" ")[0] || "bank"})`, category: /GOPAY|OVO|DANA|SHOPEEPAY/.test(text) ? "transfer/topup" : "transfer" };
  }
  if (r.kind === "Cash Withdrawal" || /^ATM Cash withdrawal$/i.test(r.kind)) return { merchant: "Cash withdrawal", category: "transfer/cash" };
  if (r.kind === "Insufficient Funds Fee") return { merchant: "Jago insufficient funds fee", category: "fees" };
  if (text.includes("GO-FOOD") || text.includes("GOFOOD")) return { merchant: "GoFood", category: "food/delivery" };
  if (text.includes("GO-RIDE") || text.includes("GORIDE") || text.includes("#RB")) return { merchant: "Gojek", category: "transport/ride-hailing" };
  if (text.includes("GOSEND")) return { merchant: "GoSend", category: "other" };
  if (text.includes("PLN") && text.includes("TOKEN")) return { merchant: "PLN", category: "bills/electricity" };
  if (text.includes("BIZNET") || text.includes("INDIHOME")) return { merchant: text.includes("BIZNET") ? "Biznet" : "IndiHome", category: "bills/phone-internet" };
  if (text.includes("PAJAK")) return { merchant: "Pajak Online", category: "tax" };
  if (src.startsWith("Tokopedia")) return { merchant: "Tokopedia", category: "shopping/online" };
  if (src.startsWith("Shopee Indonesia")) return { merchant: "Shopee", category: "shopping/online" };
  for (const [needle, name] of [
    ["CLOUDFLARE", "Cloudflare"],
    ["COMMANDCODE", "CommandCode.ai"],
    ["ZOHO", "Zoho"],
    ["X CORP", "X Premium"],
    ["DEEPSEEK", "DeepSeek"],
    ["ORACLE", "Oracle Cloud"],
    ["GOOGLE", "Google"],
    ["OPENAI", "OpenAI"],
    ["ANTHROPIC", "Anthropic"],
    ["GITHUB", "GitHub"],
  ] as const) {
    if (src.toUpperCase().includes(needle)) return { merchant: name, category: "subscriptions" };
  }
  if (/SINGAPORE|CHANGI|MALAYSIA|KUALA LUMPUR|BANGKOK/.test(text)) {
    return { merchant: text.includes("BUS/MRT") ? "Bus/MRT Singapore" : title(r.source[0] ?? "Abroad"), category: "travel" };
  }
  if (r.kind === "Payment with Jago Pay" && /^GoPay$/i.test(r.source[0] ?? "")) return { merchant: "GoPay", category: null };
  if (r.kind === "QRIS Payment") {
    // The merchant is named in the statement itself: same rules as GoPay merchants (warungs and cafés by default).
    const name = r.source[0] ?? "QRIS";
    return { merchant: cleanGopayName(name), category: /^(iseller|qris)\b/i.test(name) ? null : gopayCategory(name) };
  }
  return { merchant: counterpart ? title(counterpart) : null, category: null };
}

/** Readable description of a Jago row: counterparty, transaction type, notes (bank reference lines dropped). */
export function describeJago(r: JagoRow): string {
  const src = r.source.filter((s) => !/^[0-9A-Za-z]{15,}ID-?$|^\d$/.test(s));
  return [src.join(" "), r.kind, r.notes.join(" ")]
    .filter(Boolean)
    .join(" · ")
    // Same cleanup as the first imports, so re-importing a statement matches rows already saved.
    .replace(/&#43;/g, "+")
    .replace(/&amp;/g, "&")
    .slice(0, 500);
}
