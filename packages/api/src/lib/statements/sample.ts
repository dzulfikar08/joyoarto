// Made-up Bank Jago and GoPay statements, printed in the layout pdf.js extracts from the real PDFs, for the public demo
// ("try it with a sample") and tests. The person, accounts and ids are fictional; balances are computed so every check
// passes like a real statement's would.

type Row = { day: number; time: string; source: string[]; kind: string; notes?: string[]; amount: number; gopay?: string };
type Pocket = { name: string; id: string; previous: number; rows: Row[] };
type GopayRow = { day: number; time: string; name: string; id?: string; method: string; amount: number | null };

const HOLDER = "RINA PRATAMA";
const MONTH = { n: "10", short: "Oct", long: "Oktober", year: "2026" };
const rp = (r: number) => r * 100;

/** 1250000 (minor units) -> "12.500,00". */
function idr(minor: number): string {
  const v = Math.abs(minor);
  return `${Math.floor(v / 100).toLocaleString("de-DE")},${String(v % 100).padStart(2, "0")}`;
}
const signed = (minor: number) => `${minor < 0 ? "-" : "+"}${idr(minor)}`;
const dd = (d: number) => String(d).padStart(2, "0");

/** GoPay transaction id: 16 digits + letters + "ID". The Jago statement prints it wrapped as "...ID-" + "1". */
const gid = (day: number, n: number, tail: string) => `03${MONTH.year}${MONTH.n}${dd(day)}00${String(3600 + n).padStart(4, "0")}${tail}ID`;

const G = {
  kopi: gid(2, 1, "KPKNGNAQ"),
  bakso: gid(4, 2, "BKSPKNOR"),
  indomaret: gid(9, 3, "INDMRTSX"),
  apotek: gid(15, 4, "APTKKDXV"),
  seduh: gid(21, 5, "SDHKPZLM"),
  ayam: gid(27, 6, "AYMGPRKB"),
};

const POCKETS: Pocket[] = [
  {
    name: "Main Pocket",
    id: "500000004321",
    previous: rp(3_250_000),
    rows: [
      { day: 1, time: "06:12", source: ["PT SINAR MAJU NUSANTARA", "BCA 8830012345"], kind: "Incoming Transfer", notes: ["BI FAST Transfer", "Gaji Oktober"], amount: rp(12_500_000) },
      { day: 1, time: "06:30", source: ["Tabungan Si Kecil", "Movement between Pockets"], kind: "Pocket Money In", amount: -rp(2_000_000) },
      { day: 1, time: "06:31", source: ["Dana Darurat", "Movement between Pockets"], kind: "Pocket Money In", amount: -rp(1_000_000) },
      { day: 2, time: "07:37", source: ["GoPay", `${G.kopi}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(28_000), gopay: G.kopi },
      { day: 3, time: "09:05", source: ["PLN PREPAID TOKEN", "52012345678"], kind: "Bill Payment", notes: ["TOKEN LISTRIK"], amount: -rp(302_500) },
      { day: 4, time: "12:20", source: ["GoPay", `${G.bakso}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(35_000), gopay: G.bakso },
      { day: 5, time: "08:00", source: [HOLDER, "GoPay 081234567890"], kind: "Top Up Wallet", amount: -rp(300_000) },
      { day: 5, time: "19:45", source: ["BIZNET NETWORKS"], kind: "Bill Payment", notes: ["Internet rumah"], amount: -rp(375_000) },
      { day: 7, time: "10:10", source: ["IBU SITI AMINAH", "BRI 0012345678901"], kind: "Outgoing Transfer", notes: ["Kiriman ibu"], amount: -rp(1_500_000) },
      { day: 9, time: "17:02", source: ["GoPay", `${G.indomaret}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(187_300), gopay: G.indomaret },
      { day: 11, time: "13:15", source: ["Tokopedia", "INV/20261011/MPL/123456"], kind: "Payment with Jago Pay", amount: -rp(459_000) },
      { day: 12, time: "08:30", source: ["WARUNG BU SRI"], kind: "QRIS Payment", amount: -rp(22_000) },
      { day: 14, time: "16:40", source: ["KOST MELATI", "Mandiri 1440098765432"], kind: "Outgoing Transfer", notes: ["Sewa Oktober"], amount: -rp(2_750_000) },
      { day: 15, time: "20:05", source: ["GoPay", `${G.apotek}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(96_500), gopay: G.apotek },
      { day: 18, time: "11:00", source: ["ATM BERSAMA MALANG"], kind: "Cash Withdrawal", amount: -rp(500_000) },
      { day: 21, time: "15:22", source: ["GoPay", `${G.seduh}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(42_000), gopay: G.seduh },
      { day: 24, time: "09:48", source: ["GOOGLE *YouTubePremium", "g.co/helppay"], kind: "Debit Card Payment", amount: -rp(54_990) },
      { day: 25, time: "18:30", source: ["BAKMI JAWA PAK DIN"], kind: "QRIS Payment", amount: -rp(64_000) },
      { day: 27, time: "19:10", source: ["GoPay", `${G.ayam}-`, "1"], kind: "Payment with Jago Pay", notes: ["004 - Gopay - Generic"], amount: -rp(58_000), gopay: G.ayam },
      { day: 29, time: "21:00", source: ["DIMAS PRAYOGO", "Jago 109876543210"], kind: "Incoming Transfer", notes: ["Patungan kado"], amount: rp(150_000) },
    ],
  },
  {
    name: "Tabungan Si Kecil",
    id: "500100007788",
    previous: rp(6_000_000),
    rows: [{ day: 1, time: "06:30", source: ["Main Pocket", "Movement between Pockets"], kind: "Pocket Money In", amount: rp(2_000_000) }],
  },
  {
    name: "Dana Darurat",
    id: "500100009911",
    previous: rp(18_500_000),
    rows: [{ day: 1, time: "06:31", source: ["Main Pocket", "Movement between Pockets"], kind: "Pocket Money In", amount: rp(1_000_000) }],
  },
];

const GOPAY_ROWS: GopayRow[] = [
  { day: 2, time: "07:37", name: "KOPI KENANGAN SOEKARNO HATTA QR BRI 1 1", id: G.kopi, method: "Jago", amount: -rp(28_000) },
  { day: 4, time: "12:20", name: "BAKSO PAK NO DINOYO", id: G.bakso, method: "Jago", amount: -rp(35_000) },
  { day: 5, time: "08:00", name: "GoPay top up", method: "Jago", amount: rp(300_000) },
  { day: 6, time: "18:15", name: "PECEL ANA BLITAR", method: "GoPay Saldo", amount: -rp(18_000) },
  { day: 9, time: "17:02", name: "INDOMARET SUMBERSARI", id: G.indomaret, method: "Jago", amount: -rp(187_300) },
  { day: 13, time: "07:50", name: "PERTAMINA 54.651.02", method: "GoPay Saldo", amount: -rp(100_000) },
  { day: 15, time: "20:05", name: "APOTEK K24 SUHAT", id: G.apotek, method: "Jago", amount: -rp(96_500) },
  { day: 21, time: "15:22", name: "SEDUH KOPI TLOGOMAS", id: G.seduh, method: "Jago", amount: -rp(42_000) },
  { day: 21, time: "15:22", name: "Cashback SEDUH KOPI TLOGOMAS", method: "GoPay Coins", amount: null },
  { day: 23, time: "12:40", name: "MIE GACOAN SUHAT", method: "GoPay Saldo", amount: -rp(46_000) },
  { day: 27, time: "19:10", name: "AYAM GEPREK BENSU", id: G.ayam, method: "Jago", amount: -rp(58_000) },
];

function pocketText(p: Pocket): string[] {
  const inc = p.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const out = -p.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const lines = [p.name, `Pocket ID ${p.id}`, "Previous Balance", "Total Incoming", "Total Outgoing", "Closing Balance"];
  lines.push(idr(p.previous), `+${idr(inc)}`, `-${idr(out)}`, idr(p.previous + inc - out));
  lines.push("Date & Time Source/Destination Transaction Details Notes Amount Balance");
  let balance = p.previous;
  p.rows.forEach((r, i) => {
    balance += r.amount;
    const ref = `${MONTH.year.slice(2)}${MONTH.n}${dd(r.day)}-${p.id.slice(-4)}-${String(i + 1).padStart(6, "0")}`;
    lines.push(`${dd(r.day)} ${MONTH.short} ${MONTH.year}`, r.time, ...r.source, r.kind, `ID# ${ref}`, ...(r.notes ?? []), `${signed(r.amount)} ${idr(balance)}`);
  });
  return lines;
}

/** A made-up Bank Jago monthly statement (three pockets) that passes every balance check. */
export function sampleJagoText(): string {
  return [
    `Monthly Statements ${MONTH.long} ${MONTH.year} Page 1 of 2`,
    "PT Bank Jago Tbk is licensed and supervised by Financial Services Authority (OJK)",
    `${HOLDER} / ${POCKETS[0]!.id}`,
    ...POCKETS.flatMap(pocketText),
  ].join("\n");
}

/** The matching GoPay e-statement: names the merchants behind the Jago "Gopay - Generic" payments. */
export function sampleGopayText(): string {
  const money = GOPAY_ROWS.filter((r) => r.amount !== null);
  const inc = money.filter((r) => r.amount! > 0).reduce((s, r) => s + r.amount!, 0);
  const out = -money.filter((r) => r.amount! < 0).reduce((s, r) => s + r.amount!, 0);
  const rupiah = (minor: number) => Math.floor(Math.abs(minor) / 100).toLocaleString("de-DE");
  const lines = [
    `gopay E-statement Halaman 1 dari 1 Periode transaksi : 1 ${MONTH.long} ${MONTH.year} - 31 ${MONTH.long} ${MONTH.year}`,
    "Total Coins dipakai",
    "0",
    "Total pemasukan",
    `Rp${rupiah(inc)}`,
    "Total pengeluaran",
    `Rp${rupiah(out)}`,
    "Tanggal Transaksi ID transaksi Metode pembayaran Jumlah",
  ];
  GOPAY_ROWS.forEach((r, i) => {
    const id = r.id ?? gid(r.day, 50 + i, "XQWRTZ");
    const amount = r.amount === null ? "420" : `${r.amount < 0 ? "-" : ""}Rp${rupiah(r.amount)}`;
    lines.push(`${dd(r.day)}/${MONTH.n}/${MONTH.year}`, r.time, `${r.name} ${id.slice(0, 20)}`, id.slice(20), `${r.method} ${amount}`);
  });
  return lines.join("\n");
}
