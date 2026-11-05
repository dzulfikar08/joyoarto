// Test fixtures for statements JoyoArto does not read (format requests).

// A made-up BCA-like "rekening koran" in the shape pdf.js extracts: the person, account, merchants and amounts are
// fictional, and every one of them must be gone from the skeleton.
export const PERSON = ["SURYANINGSIH", "WIDYASTUTI"];
export const ACCOUNT = "8831207754";
export const MERCHANTS = ["Kopikenangan", "TOKOPEDIA", "Alfamart", "Warteg Bahari", "Indomaret", "SPOTIFY"];

export function bcaStatement(rows: number, opts: { holder?: string; account?: string; month?: string } = {}) {
  const holder = opts.holder ?? PERSON.join(" ");
  const account = opts.account ?? ACCOUNT;
  const month = opts.month ?? "OKTOBER 2026";
  const lines = [
    "REKENING TAHAPAN",
    "KCU MALANG",
    `${holder}                      NO. REKENING : ${account}`,
    "JL KENANGA INDAH 17 RT 003 RW 005",
    `HALAMAN : 1 / 2`,
    `PERIODE : ${month}`,
    "MATA UANG : IDR",
    "TANGGAL KETERANGAN CBG MUTASI SALDO",
    "01/10 SALDO AWAL 4.512.300,00",
  ];
  let balance = 4_512_300;
  for (let i = 0; i < rows; i++) {
    const m = MERCHANTS[i % MERCHANTS.length]!;
    const amt = 12_500 + i * 1_337;
    balance -= amt;
    lines.push(`${String(2 + (i % 27)).padStart(2, "0")}/10 TRSF E-BANKING DB ${String(1000 + i).padStart(4, "0")}/FTSCY/WS95031`);
    lines.push(`QRIS ${m}`);
    lines.push(`${amt.toLocaleString("de-DE")},00 DB ${balance.toLocaleString("de-DE")},00`);
  }
  lines.push("28/10 TRSF E-BANKING CR 2810/FTSCY/WS95051");
  lines.push("BUDI HARTONO GAJI");
  lines.push("12.000.000,00");
  lines.push(`HALAMAN : 2 / 2`);
  lines.push("SALDO AWAL : 4.512.300,00");
  lines.push("MUTASI CR : 12.000.000,00 1");
  lines.push("MUTASI DB : 1.234.567,00 25");
  lines.push("SALDO AKHIR : 15.277.733,00");
  return lines.join("\n");
}
