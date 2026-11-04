// A typed or spoken capture ("beli kopi kenangan dua puluh lima ribu pakai gopay", "gaji masuk 16 juta", "kopi 25rb
// gopay") as a transaction draft, by rules alone. Pure: the server uses it when no model is available or the model
// fails, and to fill gaps in a model's draft. Nothing here saves anything; the member reviews the draft first.

import { parseAmountText } from "./amount-text";
import { addDays } from "./dashboard";

export type DraftAccount = { id: string; name: string; institution?: string | null; type?: string | null };
export type DraftCategory = { slug: string; name: string; kind: string };

export type CaptureDraft = {
  /** Absolute amount in minor units; null when none was found. */
  amount: number | null;
  direction: "in" | "out";
  /** The merchant or counterparty ("Kopi Kenangan"); null when the text names none. */
  merchant: string | null;
  /** What it was, as short as possible ("Kopi Kenangan", "Gaji"). */
  description: string;
  note: string | null;
  category: string | null;
  accountId: string | null;
  /** YYYY-MM-DD (WIB). */
  date: string;
  source: "ai" | "rules";
};

// ---- spoken numbers (Bahasa Indonesia, plus English digits Whisper may write) ----

const UNITS: Record<string, number> = {
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
};
/** "seratus" is "satu ratus", and so on. */
const SE: Record<string, string[]> = { seratus: ["satu", "ratus"], seribu: ["satu", "ribu"], sejuta: ["satu", "juta"], semiliar: ["satu", "miliar"] };
const BIG: Record<string, number> = { ribu: 1000, rb: 1000, juta: 1_000_000, jt: 1_000_000, miliar: 1e9, milyar: 1e9 };

/**
 * Indonesian number words as a number: "dua puluh lima ribu" = 25000, "dua ratus lima puluh ribu" = 250000,
 * "16 juta" = 16000000, "satu setengah juta" = 1500000. Null when the words are not a number.
 */
export function wordsToNumber(phrase: string): number | null {
  const words = phrase
    .toLowerCase()
    .replace(/(\d)[.](?=\d{3}\b)/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => SE[w] ?? [w]);
  if (!words.length) return null;
  let total = 0;
  /** The part under a thousand being built, and its last unit (for "puluh", "ratus", "belas"). */
  let group = 0;
  let last = 0;
  let half = false;
  for (const w of words) {
    if (/^\d+([.,]\d+)?$/.test(w)) {
      last = Number(w.replace(",", "."));
      group += last;
    } else if (w === "setengah") half = true;
    else if (w in UNITS) {
      last = UNITS[w]!;
      group += last;
    } else if (w === "belas") {
      group += 10;
      last = 0;
    } else if (w === "puluh" || w === "ratus") {
      const scale = w === "puluh" ? 10 : 100;
      group = group - last + (last || 1) * scale;
      last = 0;
    } else if (w in BIG) {
      total += (group + (half ? 0.5 : 0) || 1) * BIG[w]!;
      group = 0;
      last = 0;
      half = false;
    } else return null;
  }
  const n = total + group + (half ? 0.5 : 0);
  return n > 0 ? n : null;
}

const NUMBER_WORD = "(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|semiliar|setengah|belas|puluh|ratus|ribu|juta|miliar|milyar)";
/** A run of number words or digits ending in a unit ("dua puluh lima ribu", "16 juta", "25rb", "Rp 25.000"). */
const SPOKEN = new RegExp(`(?:^|\\s)((?:(?:\\d+(?:[.,]\\d+)?|${NUMBER_WORD})\\s+)*(?:\\d+(?:[.,]\\d+)?\\s*)?(?:ribu|rb|juta|jt|miliar|milyar|${NUMBER_WORD}))(?=\\s|$|[.,!?])`, "i");
const SHORTHAND = /(?:^|\s)([+-]?\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)*\s*(?:rb|ribu|k|jt|juta|miliar)?)(?=\s|$|[.,!?])/gi;

/** The first amount in a sentence, with the text it was read from. A bare small number ("2 gelas") loses to one with a unit. */
export function findAmount(text: string, currency = "IDR"): { amount: number; sign: -1 | 1 | null; match: string } | null {
  let best: { amount: number; sign: -1 | 1 | null; match: string; score: number } | null = null;
  for (const m of text.matchAll(SHORTHAND)) {
    const raw = m[1]!.replace(/\s+/g, " ").trim();
    try {
      const p = parseAmountText(raw, currency);
      if (p.amount <= 0) continue;
      const score = /[a-z]/i.test(raw) ? 3 : /\d[.,]\d{3}\b|\d{4,}/.test(raw) ? 2 : 0;
      if (!best || score > best.score) best = { amount: p.amount, sign: p.sign, match: m[1]!, score };
    } catch {
      // Not an amount; try the next one.
    }
  }
  if (best && best.score > 0) return best;
  const spoken = SPOKEN.exec(text);
  if (spoken?.[1]) {
    const n = wordsToNumber(spoken[1]);
    if (n !== null && n > 0) return { amount: Math.round(n * 100), sign: null, match: spoken[1] };
  }
  return best;
}

// ---- direction, account, date, category ----

const INCOME = /\b(gaji|gajian|salary|masuk|diterima|terima|dapat|dapet|refund|cashback|bonus|thr|income|received|dikirimin|transferan masuk)\b/i;

const ACCOUNT_LEAD = /\b(pakai|pake|pk|via|dari|lewat|bayar pakai|bayar pake|ke|using|with|from)\s+/i;

/** Brands people say for an account ("gopay", "bca"), matched against the household's account names and institutions. */
export function matchAccount(text: string, accounts: readonly DraftAccount[]): { id: string; match: string } | null {
  const lower = ` ${text.toLowerCase()} `;
  let best: { id: string; match: string; score: number } | null = null;
  for (const a of accounts) {
    const names = [a.name, a.institution ?? ""]
      .flatMap((n) => [n, ...n.split(/\s+/)])
      .map((n) => n.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim())
      .filter((n) => n.length >= 3 && !["bank", "wallet", "account", "rekening", "tabungan", "kartu", "card"].includes(n));
    for (const n of names) {
      const at = lower.indexOf(` ${n} `);
      if (at === -1) continue;
      const score = n.length + (ACCOUNT_LEAD.test(lower.slice(Math.max(0, at - 12), at + 1)) ? 10 : 0);
      if (!best || score > best.score) best = { id: a.id, match: n, score };
    }
  }
  if (best) return { id: best.id, match: best.match };
  if (/\b(cash|tunai)\b/i.test(text)) {
    const cash = accounts.find((a) => a.type === "cash" || /cash|tunai|dompet/i.test(a.name));
    if (cash) return { id: cash.id, match: /\bcash\b/i.test(text) ? "cash" : "tunai" };
  }
  return null;
}

export function dateIn(text: string, today: string): { date: string; match: string | null } {
  const t = text.toLowerCase();
  const ago = /\b(\d+|dua|tiga|empat|lima|enam|tujuh)\s+hari\s+(?:lalu|yang lalu)\b/.exec(t);
  if (ago) {
    const n = /\d/.test(ago[1]!) ? Number(ago[1]) : (UNITS[ago[1]!] ?? 0);
    if (n > 0 && n <= 31) return { date: addDays(today, -n), match: ago[0] };
  }
  const kemarin = /\b(kemarin lusa|kemaren lusa)\b/.exec(t);
  if (kemarin) return { date: addDays(today, -2), match: kemarin[0] };
  const y = /\b(kemarin|kemaren|kmrn|yesterday)\b/.exec(t);
  if (y) return { date: addDays(today, -1), match: y[0] };
  return { date: today, match: null };
}

/** Keywords per default category slug; only slugs the household has are used. */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(kopi|coffee|kenangan|starbucks|janji jiwa|fore|chatime|boba|snack|jajan|camilan)\b/i, "food/coffee"],
  [/\b(gofood|grabfood|shopeefood)\b/i, "food/delivery"],
  [/\b(makan|nasi|bakso|mie|sate|padang|warteg|resto|restoran|lunch|dinner|sarapan|breakfast|ayam|soto|martabak|pizza|mcd|kfc)\b/i, "food/dining"],
  [/\b(indomaret|alfamart|superindo|hypermart|sayur|belanja bulanan|groceries|pasar)\b/i, "food/groceries"],
  [/\b(gojek|goride|grab|grabbike|grabcar|maxim|ojek|ojol|taksi|taxi|bluebird)\b/i, "transport/ride-hailing"],
  [/\b(bensin|pertalite|pertamax|spbu|shell|fuel|isi bensin)\b/i, "transport/fuel"],
  [/\b(parkir|tol|e-?toll|parking)\b/i, "transport/parking-toll"],
  [/\b(krl|mrt|lrt|transjakarta|busway|kereta|commuter)\b/i, "transport/public"],
  [/\b(listrik|pln|token listrik)\b/i, "bills/electricity"],
  [/\b(pdam|air)\b/i, "bills/water"],
  [/\b(pulsa|kuota|paket data|internet|indihome|wifi|biznet)\b/i, "bills/phone-internet"],
  [/\b(netflix|spotify|youtube premium|icloud|langganan|subscription|disney)\b/i, "subscriptions"],
  [/\b(tokopedia|shopee|lazada|tiktok shop|blibli)\b/i, "shopping/online"],
  [/\b(baju|celana|sepatu|kaos|kemeja)\b/i, "shopping/clothing"],
  [/\b(obat|apotek|dokter|klinik|rumah sakit|rs)\b/i, "health"],
  [/\b(gaji|gajian|salary|thr)\b/i, "income/salary"],
  [/\b(refund|cashback)\b/i, "income/refund"],
  [/\b(bunga|interest)\b/i, "income/interest"],
  [/\b(top ?up|topup|isi saldo)\b/i, "transfer/topup"],
];

export function categoryIn(text: string, categories: readonly DraftCategory[], direction: "in" | "out"): string | null {
  const have = new Set(categories.map((c) => c.slug));
  for (const [re, slug] of CATEGORY_WORDS) {
    if (!re.test(text) || !have.has(slug)) continue;
    const kind = categories.find((c) => c.slug === slug)?.kind;
    if (direction === "in" && kind === "expense") continue;
    if (direction === "out" && kind === "income") continue;
    return slug;
  }
  return null;
}

// ---- the description ----

const FILLER = /\b(tadi|barusan|baru saja|td|beli|membeli|bayar|bayarin|buat|untuk|utk|sebesar|seharga|harga|habis|keluar|masuk|dapat|dapet|terima|diterima|pengeluaran|pemasukan|hari ini|sih|dong|ya|aku|saya|gue|gw|i|bought|paid|for|spent|on|di|at)\b/gi;

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Rules-only draft. Always returns one; `amount` is null when no amount was found. */
export function parseCaptureRules(
  input: string,
  ctx: { today: string; accounts: readonly DraftAccount[]; categories: readonly DraftCategory[]; currency?: string },
): CaptureDraft {
  const text = input.replace(/\s+/g, " ").trim();
  const amount = findAmount(text, ctx.currency);
  const account = matchAccount(text, ctx.accounts);
  const date = dateIn(text, ctx.today);
  const direction: "in" | "out" = amount?.sign === 1 || (amount?.sign !== -1 && INCOME.test(text)) ? "in" : "out";

  let rest = ` ${text} `;
  if (amount) rest = rest.replace(amount.match, " ");
  if (account) rest = rest.replace(new RegExp(`(?:\\b(?:pakai|pake|pk|via|dari|lewat|ke|using|with|from)\\s+)?\\b${account.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
  if (date.match) rest = rest.replace(date.match, " ");
  rest = rest.replace(/\b(rp\.?|rupiah|idr)\b/gi, " ");
  const isSalary = /\b(gaji|gajian|salary)\b/i.test(rest);
  rest = rest.replace(FILLER, " ").replace(/[.,!?]+/g, " ").replace(/\s+/g, " ").trim();
  const description = isSalary && !rest ? "Gaji" : titleCase(rest) || (direction === "in" ? "Pemasukan" : "Pengeluaran");
  const merchant = rest && !/^(gaji|gajian|salary)$/i.test(rest) ? titleCase(rest).slice(0, 80) : null;

  return {
    amount: amount?.amount ?? null,
    direction,
    merchant,
    description: description.slice(0, 120),
    note: null,
    category: categoryIn(text, ctx.categories, direction),
    accountId: account?.id ?? null,
    date: date.date,
    source: "rules",
  };
}
