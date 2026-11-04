// GoPay e-statement (transaction history PDF). Each row: date, time, merchant, GoPay transaction id (wrapped over two
// lines), payment method (Jago, GoPay Saldo, GoPay Coins) and amount. Coins rows ("Cashback ...") are points, not money.

export type GopayRow = {
  date: string;
  time: string;
  name: string;
  id: string;
  /** "Jago", "GoPay Saldo", "Jago GoPay Coins", ... */
  method: string;
  /** Minor units for rupiah rows; null for coin rows. */
  amount: number | null;
};

export type GopayStatement = {
  rows: GopayRow[];
  totals: { incoming: number | null; outgoing: number | null; coinsUsed: number | null };
  problems: string[];
};

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ID_START = /^[A-Z0-9]\d{12,}[A-Za-z0-9]*$/;

export function isGopayStatement(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return /gopay/i.test(t) && /E-statement/.test(t) && /Metode pembayaran/.test(t);
}

const rp = (s: string | undefined) => (s ? Number(s.replace(/\./g, "")) * 100 : null);

export function parseGopay(text: string): GopayStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const groups: { date: string; lines: string[] }[] = [];
  for (const l of lines) {
    const d = DATE.exec(l);
    if (d) {
      groups.push({ date: `${d[3]}-${d[2]}-${d[1]}`, lines: [] });
      continue;
    }
    if (/^(E-statement|Tanggal Transaksi|PT Dompet|Bank Indonesia)/.test(l)) continue;
    groups.at(-1)?.lines.push(l);
  }
  const rows: GopayRow[] = [];
  const problems: string[] = [];
  for (const g of groups) {
    const tokens = g.lines.join(" ").split(" ");
    const time = tokens.shift() ?? "";
    const at = tokens.findIndex((t) => ID_START.test(t));
    if (at < 0) {
      problems.push(`${g.date}: no transaction id in "${g.lines.join(" ").slice(0, 60)}"`);
      continue;
    }
    let j = at;
    let id = tokens[j]!;
    while (!id.endsWith("ID") && j + 1 < tokens.length) id += tokens[++j];
    const rest = tokens.slice(j + 1).join(" ");
    const m = /(-?)(Rp)?([\d.]+)$/.exec(rest);
    const method = (m ? rest.slice(0, m.index) : rest).trim();
    const amount = m?.[2] ? Number(m[3]!.replace(/\./g, "")) * 100 * (m[1] ? -1 : 1) : null;
    rows.push({ date: g.date, time, name: tokens.slice(0, at).join(" "), id, method, amount });
  }
  const flat = text.replace(/\s+/g, " ");
  const totals = {
    incoming: rp(/Total pemasukan\s*Rp([\d.]+)/.exec(flat)?.[1]),
    outgoing: rp(/Total pengeluaran\s*Rp([\d.]+)/.exec(flat)?.[1]),
    coinsUsed: rp(/Total Coins dipakai\s*([\d.]+)/.exec(flat)?.[1]),
  };
  // The statement's spending total excludes the part GoPay Coins paid for.
  const inc = rows.filter((r) => (r.amount ?? 0) > 0).reduce((s, r) => s + r.amount!, 0);
  const out = -rows.filter((r) => (r.amount ?? 0) < 0).reduce((s, r) => s + r.amount!, 0);
  if (totals.incoming !== null && inc !== totals.incoming) problems.push(`incoming ${inc} vs statement ${totals.incoming}`);
  if (totals.outgoing !== null && out - (totals.coinsUsed ?? 0) !== totals.outgoing) {
    problems.push(`outgoing ${out} (minus coins ${totals.coinsUsed ?? 0}) vs statement ${totals.outgoing}`);
  }
  return { rows, totals, problems };
}
