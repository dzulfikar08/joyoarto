// A masked outline ("skeleton") of a statement JoyoArto cannot read yet, for a format request: enough to write a
// parser (layout, column labels, date and amount shapes, how debit and credit are marked), nothing about the member.
//
// - every digit becomes 9 (shapes stay: 99/99/9999, 9.999.999,99, 99:99);
// - every word that is not statement vocabulary (ALLOWED: labels, months, banks, transaction-type words) becomes a
//   shape of a fixed length by its case: XXXX, Xxxx, xxxx, XxXx (so name lengths do not leak either);
// - single letters stay (D/K, C, E-banking): an initial at most;
// - punctuation, spacing and line breaks stay.
//
// verifySkeleton() checks the result before anything leaves; the server refuses to send a skeleton that fails it.
// Pure: no I/O, runs in the Worker, in tests and could run in a browser.

const WORDS = `
tanggal tgl tgl. transaksi keterangan ket uraian deskripsi mutasi saldo awal akhir debit debet kredit db cr dr
periode halaman hal dari sampai nomor no rekening rek nama mata uang idr usd sgd eur rp total jumlah nominal cabang
alamat produk jenis tabungan giro valuta laporan koran ringkasan posisi pukul waktu jam referensi ref berita catatan
status berhasil gagal sukses masuk keluar pemasukan pengeluaran penerimaan pembayaran biaya adm admin administrasi bunga
pajak setoran setor tunai tarikan tarik penarikan kartu pembelian beli bayar byr pemb pmb top up topup transfer trsf trf
tf pindah buku pindahbuku switching kliring rtgs skn bi fast bifast banking ebanking mbanking ib internet mobile qris qr
atm edc pos va virtual account otomatis autodebet autodebit auto tagihan angsuran cicilan pinjaman limit minimum jatuh
tempo statement statements estatement monthly bulanan tahunan cashback refund reversal koreksi promo diskon dompet
digital elektronik sub subtotal grand page of dan ke di untuk pada atas dengan atau per tanpa trx tx kode metode
pengirim penerima tujuan asal sumber layanan merchant pembelian pulsa paket data listrik token pln pdam bpjs gaji
payroll bulan tahun hari minggu senin selasa rabu kamis jumat sabtu notes note
date transaction transactions posting post value description details detail amount balance opening closing beginning
ending previous current available credit withdrawal withdrawals deposit deposits number name currency period page
fee fees charge charges interest tax payment payments purchase incoming outgoing in out money branch type reference
time from to the and for summary card cash wallet pocket pockets main savings saving movement between bill generic
method id code successful success failed pending completed sender recipient source destination customer
account accounts holder statement total totals subtotal net gross debits credits brought forward carried
januari februari maret april mei juni juli agustus september oktober november desember
january february march may june july august october december
jan feb mar apr jun jul agu agt ags aug sep sept okt oct nov des dec
monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun
bank bca mandiri bri bni cimb niaga permata danamon bsi syariah btn ocbc nisp seabank blu jenius btpn jago allo neo
neobank ovo dana shopeepay shopee linkaja gopay gojek flip mega panin maybank uob hsbc citibank dbs digibank superbank
krom bjb muamalat sinarmas bukopin paylater gopaylater spaylater kredivo akulaku isaku doku xendit midtrans livin brimo
wondr mybca klikbca octo tmrw sakuku visa mastercard jcb gpn prima alto jalin bersama link tbk pt persero
`;

/** Statement vocabulary, lower case. Not merchants, not person names. */
export const ALLOWED: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean).map((w) => w.replace(/\.$/, "")));

/** Bank and e-wallet names for the "likely bank" guess, as they are usually written. */
const BANKS: Record<string, string> = {
  bca: "BCA", mandiri: "Mandiri", bri: "BRI", bni: "BNI", cimb: "CIMB Niaga", permata: "Permata", danamon: "Danamon", bsi: "BSI", btn: "BTN",
  ocbc: "OCBC", seabank: "SeaBank", blu: "blu", jenius: "Jenius", jago: "Jago", allo: "Allo", neo: "Neo", ovo: "OVO", dana: "DANA",
  shopeepay: "ShopeePay", linkaja: "LinkAja", gopay: "GoPay", flip: "Flip", mega: "Mega", panin: "Panin", maybank: "Maybank", uob: "UOB",
  hsbc: "HSBC", citibank: "Citibank", dbs: "DBS", superbank: "Superbank", krom: "Krom", bjb: "BJB", muamalat: "Muamalat", sinarmas: "Sinarmas",
  bukopin: "Bukopin", kredivo: "Kredivo", akulaku: "Akulaku",
};

const WORD = /[\p{L}\p{M}]+/gu;
const DIGIT = /[\p{Nd}\p{No}\p{Nl}]/gu;
const MASKS: ReadonlySet<string> = new Set(["XXXX", "Xxxx", "xxxx", "XxXx"]);
/** Notes the skeleton adds itself: a run of identical lines, and lines left out. Stripped before verifying. */
const RUN_NOTE = / ⟨×\d+⟩$/u;
const OMITTED = /^⟨… \d+ lines? omitted …⟩$/u;

export const SKELETON_MAX_LINES = 200;
export const SKELETON_MAX_CHARS = 15_000;

function isUpper(s: string) {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}
function isLower(s: string) {
  return s === s.toLowerCase() && s !== s.toUpperCase();
}

/** A word's mask: its case pattern at a fixed length of 4. */
export function shapeOf(word: string): string {
  const [first = "", ...rest] = [...word];
  const tail = rest.join("");
  if (isUpper(word)) return "XXXX";
  if (isLower(word) || !/\p{L}/u.test(word)) return "xxxx";
  if (isUpper(first) && (!tail || isLower(tail))) return "Xxxx";
  return "XxXx";
}

const allowed = (word: string) => [...word].length === 1 || ALLOWED.has(word.toLowerCase());

/** One line masked. */
export function maskLine(line: string): string {
  return line
    .replace(/\t/g, "  ")
    .replace(WORD, (w) => (allowed(w) ? w : shapeOf(w)))
    .replace(DIGIT, "9")
    .replace(/\s+$/u, "");
}

export type Skeleton = {
  /** The masked lines, collapsed and capped: what the member sees and what is sent. */
  text: string;
  /** Lines of the original text (non-empty). */
  lines: number;
  /** Lines in `text`. */
  skeletonLines: number;
  /** Pages, from "Halaman 1 dari 3" / "Page 1 of 3" markers when the statement prints them. */
  pages: number | null;
  /** The bank or e-wallet the statement most likely comes from, by the names left in the skeleton; null = unknown. */
  bank: string | null;
};

/** Consecutive identical lines become one line with a ⟨×N⟩ note. */
function collapse(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    out.push(j - i > 1 ? `${lines[i]} ⟨×${j - i}⟩` : lines[i]!);
    i = j;
  }
  return out;
}

const omitted = (n: number) => `⟨… ${n} line${n === 1 ? "" : "s"} omitted …⟩`;

/**
 * At most `maxLines` lines and `maxChars` characters: the header (first lines), the footer (last lines), and from the
 * middle each distinct row shape once, in order. Gaps get an "omitted" note.
 */
function cap(lines: string[], maxLines: number, maxChars: number): string[] {
  const size = (xs: string[]) => xs.reduce((s, x) => s + x.length + 1, 0);
  if (lines.length <= maxLines && size(lines) <= maxChars) return lines;
  const head = Math.min(60, Math.floor(maxLines * 0.3));
  const foot = Math.min(40, Math.floor(maxLines * 0.2));
  const keep = new Set<number>();
  for (let i = 0; i < Math.min(head, lines.length); i++) keep.add(i);
  for (let i = Math.max(0, lines.length - foot); i < lines.length; i++) keep.add(i);
  const seen = new Set([...keep].map((i) => lines[i]!.replace(RUN_NOTE, "")));
  let chars = size([...keep].map((i) => lines[i]!));
  // Room for the omission notes too.
  const budget = maxLines - keep.size - 20;
  let added = 0;
  for (let i = head; i < lines.length - foot && added < budget; i++) {
    const base = lines[i]!.replace(RUN_NOTE, "");
    if (seen.has(base) || chars + lines[i]!.length + 1 > maxChars - 2_000) continue;
    seen.add(base);
    keep.add(i);
    chars += lines[i]!.length + 1;
    added++;
  }
  const out: string[] = [];
  let gap = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (gap) out.push(omitted(gap));
      gap = 0;
      out.push(lines[i]!);
    } else gap++;
  }
  if (gap) out.push(omitted(gap));
  // Still too long (very wide lines): cut lines from the end of the middle, then hard-cut what is left.
  while (size(out) > maxChars && out.length > 2) out.splice(Math.floor(out.length / 2), 1);
  return out.map((l) => (l.length > maxChars ? l.slice(0, maxChars) : l));
}

function pageCount(text: string): number | null {
  let max = 0;
  for (const m of text.matchAll(/\b(?:halaman|hal\.?|page)\s*:?\s*\d+\s*(?:dari|of|\/)\s*(\d+)/giu)) max = Math.max(max, Number(m[1]));
  return max > 0 && max < 10_000 ? max : null;
}

/**
 * The most likely bank or e-wallet: the name met most often in the first lines (the letterhead), else in the whole
 * statement. Rows name other banks (transfers, top-ups), so the letterhead wins.
 */
export function guessBank(skeletonLines: readonly string[]): string | null {
  const top = (lines: readonly string[]) => {
    const score = new Map<string, number>();
    for (const line of lines) {
      for (const w of line.match(WORD) ?? []) {
        const name = BANKS[w.toLowerCase()];
        if (name) score.set(name, (score.get(name) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let n = 0;
    for (const [name, s] of score) if (s > n) [best, n] = [name, s];
    return best;
  };
  return top(skeletonLines.slice(0, 15)) ?? top(skeletonLines);
}

/** The statement's text (the lines the parsers get) to its skeleton. */
export function buildSkeleton(text: string, opts: { maxLines?: number; maxChars?: number } = {}): Skeleton {
  const original = text.split(/\r?\n/).filter((l) => l.trim());
  const masked = original.map(maskLine);
  const lines = cap(collapse(masked), opts.maxLines ?? SKELETON_MAX_LINES, opts.maxChars ?? SKELETON_MAX_CHARS);
  return { text: lines.join("\n"), lines: original.length, skeletonLines: lines.length, pages: pageCount(text), bank: guessBank(masked) };
}

export type Verification = { ok: true } | { ok: false; reason: string };

/**
 * The last check before a skeleton leaves: no digit other than 9, every word is statement vocabulary or a mask, and no
 * word of 3+ letters from the original that is not vocabulary appears in it.
 */
export function verifySkeleton(original: string, skeleton: string): Verification {
  const lines = skeleton.split("\n").filter((l) => !OMITTED.test(l)).map((l) => l.replace(RUN_NOTE, ""));
  const body = lines.join("\n");
  if (/[\p{Nd}\p{No}\p{Nl}]/u.test(body.replace(/9/g, ""))) return { ok: false, reason: "a digit other than 9" };
  const words = new Set<string>();
  for (const w of body.match(WORD) ?? []) {
    if (!allowed(w) && !MASKS.has(w)) return { ok: false, reason: "an unmasked word" };
    words.add(w.toLowerCase());
  }
  for (const w of original.match(WORD) ?? []) {
    if ([...w].length >= 3 && !ALLOWED.has(w.toLowerCase()) && words.has(w.toLowerCase())) return { ok: false, reason: "a word from the statement" };
  }
  return { ok: true };
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MONTHS = new Set(
  "januari februari maret april mei juni juli agustus september oktober november desember january february march may june july august october december jan feb mar apr jun jul agu agt ags aug sep sept okt oct nov des dec".split(" "),
);
/** A transaction row usually starts with its date: 99/99, 99-99-9999, 99 Oct 9999, 9999-99-99. */
const ROW_START = /^\s*(?:99[/.-]99\b|99 [\p{L}]+ 9999\b|9999-99-99\b)/u;

/** A line reduced to what is the same in every statement of its format: no masks, months or number lengths. */
function formatLine(line: string): string {
  return line
    .replace(RUN_NOTE, "")
    .replace(WORD, (w) => (MASKS.has(w) ? "" : MONTHS.has(w.toLowerCase()) ? "M" : w.toLowerCase()))
    .replace(/9+/g, "9")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The letterhead and column labels: the lines before the first transaction row (at most 40), reduced by formatLine,
 * keeping those with statement vocabulary. Names, months, page numbers and row counts do not change them.
 */
export function headerLines(skeleton: string): string[] {
  const out: string[] = [];
  const lines = skeleton.split("\n").filter((l) => !OMITTED.test(l));
  const first = lines.findIndex((l) => ROW_START.test(l));
  for (const raw of lines.slice(0, Math.min(first < 0 ? 40 : first, 40))) {
    const line = formatLine(raw);
    if (!(line.match(WORD) ?? []).some((w) => w.length > 1 && ALLOWED.has(w))) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

/**
 * A stable id of the statement's format: the hash of its letterhead and column labels, so two statements of the same
 * bank and layout group together (one Atur issue) whatever their rows. Falls back to the first lines' shapes.
 */
export async function formatFingerprint(skeleton: string): Promise<string> {
  let basis = headerLines(skeleton);
  if (!basis.length) basis = skeleton.split("\n").filter((l) => !OMITTED.test(l)).slice(0, 15).map(formatLine);
  return `stmt-${(await sha256Hex(basis.join("\n"))).slice(0, 16)}`;
}
