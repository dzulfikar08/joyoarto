// Bank Jago monthly statement (PDF text, one line per text line as pdf.js or pypdf extract it).
//
// Layout: a summary, then one section per pocket ("Main Pocket" / "Pocket ID 500000001234" / previous, incoming,
// outgoing and closing balance), then its rows: date, time, source lines, transaction type, "ID# ...", notes, amount
// and running balance. Every pocket is verified: each row's running balance and the section totals must add up.

export type JagoRow = {
  date: string;
  time: string;
  /** "Payment with Jago Pay", "Outgoing Transfer", "Pocket Money In", ... */
  kind: string;
  /** Counterparty lines as printed (name, bank/account, reference). */
  source: string[];
  /** Jago transaction id (ID# 260702-WWNR-A6PMLV). */
  ref: string;
  notes: string[];
  amount: number;
  balanceAfter: number;
  /** For GoPay payments: GoPay's transaction id, which its own e-statement prints. */
  gopayRef?: string;
};

export type JagoPocket = {
  name: string;
  pocketId: string;
  previous: number;
  incoming: number;
  outgoing: number;
  closing: number;
  rows: JagoRow[];
};

export type JagoStatement = {
  accountName: string | null;
  pockets: JagoPocket[];
  problems: string[];
};

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  // Indonesian-language statements.
  Mei: 5, Agu: 8, Agt: 8, Okt: 10, Des: 12,
};
const DATE = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/;
const TIME = /^\d{2}:\d{2}$/;
const MONEY = "[\\d.]+,\\d{2}";
const AMOUNT_ONLY = new RegExp(`^(.*?)\\s*([+-])\\s?(${MONEY})$`);
const AMOUNT_AND_BALANCE = new RegExp(`^(.*?)\\s*([+-])\\s?(${MONEY})\\s+(-?${MONEY})$`);
const BALANCE_ONLY = new RegExp(`^-?${MONEY}$`);

/** "1.250.000,50" -> 125000050 (rupiah has two decimals); a leading "-" makes it negative. */
export function idr(s: string): number {
  const negative = s.trim().startsWith("-");
  const [whole, frac = "00"] = s.replace(/^\s*-\s*/, "").replace(/\./g, "").split(",");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  return negative ? -value : value;
}

export function isJagoStatement(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return /Bank Jago/i.test(t) && /Pocket ID/.test(t) && /Monthly Statements/.test(t);
}

export function parseJago(text: string): JagoStatement {
  const lines = text
    // pdf.js sometimes glues the next label onto a number ("89.418,36Currency In IDR"): give it its own line.
    .replace(/(\d)(Currency In [A-Z]{3})/g, "$1\n$2")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const pockets: JagoPocket[] = [];
  const parseProblems: string[] = [];
  let current: JagoPocket | null = null;
  const accountName = lines.find((l) => / \/ \d{9,}$/.test(l))?.split(" / ")[0] ?? null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pocket = /^Pocket ID (\S+)$/.exec(line);
    if (pocket) {
      // Previous / incoming / outgoing / closing follow "Closing Balance"; a sign may sit on its own line.
      const header = lines.indexOf("Closing Balance", i);
      const nums: number[] = [];
      let j = i + 1;
      if (header < 0) {
        parseProblems.push(`${lines[i - 1] ?? "Pocket"} (${pocket[1]}): no balance summary found`);
      } else {
        j = header + 1;
        while (nums.length < 4 && j < lines.length) {
          let t = lines[j]!;
          if ((t === "+" || t === "-") && j + 1 < lines.length) t += lines[++j]!;
          const m = new RegExp(`^([+-]?)\\s?(${MONEY})$`).exec(t);
          // Previous and closing balances keep their sign (an overdrawn pocket); incoming/outgoing are totals.
          if (m) nums.push(nums.length === 0 || nums.length === 3 ? idr(m[1] + m[2]!) : idr(m[2]!));
          j++;
        }
        if (nums.length < 4) parseProblems.push(`${lines[i - 1] ?? "Pocket"} (${pocket[1]}): balance summary incomplete`);
      }
      current = {
        name: lines[i - 1]!,
        pocketId: pocket[1]!,
        previous: nums[0] ?? 0,
        incoming: nums[1] ?? 0,
        outgoing: nums[2] ?? 0,
        closing: nums[3] ?? 0,
        rows: [],
      };
      pockets.push(current);
      // Always move forward, even when the summary was not found.
      i = Math.max(i, j - 1);
      continue;
    }
    const d = DATE.exec(line);
    if (!d || !current || !TIME.test(lines[i + 1] ?? "")) continue;

    const body: string[] = [];
    let j = i + 2;
    let amount: number | null = null;
    let balance: number | null = null;
    for (; j < lines.length && j < i + 40; j++) {
      const t = lines[j]!;
      const both = AMOUNT_AND_BALANCE.exec(t);
      if (both) {
        if (both[1]) body.push(both[1]);
        amount = idr(both[3]!) * (both[2] === "-" ? -1 : 1);
        balance = idr(both[4]!);
        break;
      }
      const only = AMOUNT_ONLY.exec(t);
      if (only && BALANCE_ONLY.test(lines[j + 1] ?? "")) {
        if (only[1]) body.push(only[1]);
        amount = idr(only[3]!) * (only[2] === "-" ? -1 : 1);
        balance = idr(lines[j + 1]!);
        j++;
        break;
      }
      body.push(t);
    }
    if (amount === null || balance === null) continue;
    const idAt = body.findIndex((t) => t.startsWith("ID# "));
    if (idAt < 1) continue;
    const before = body.slice(0, idAt);
    const kind = before.at(-1)!;
    const source = before.slice(0, -1);
    const notes = body.slice(idAt + 1).filter((n) => !n.startsWith("physicial"));
    const month = MONTHS[d[2]!];
    if (!month) {
      parseProblems.push(`${current.name}: unknown month in "${line}"`);
      continue;
    }
    const row: JagoRow = {
      date: `${d[3]}-${String(month).padStart(2, "0")}-${d[1]}`,
      time: lines[i + 1]!,
      kind,
      source,
      ref: body[idAt]!.slice(4),
      notes,
      amount,
      balanceAfter: balance,
    };
    // GoPay payments carry GoPay's id on the line after "GoPay"/"Tokopedia", wrapped as "...ID-" + "1".
    const gopay = source.find((s) => /^[A-Z0-9]\d{12,}[A-Za-z0-9]*ID-?$/.test(s));
    if (gopay) row.gopayRef = gopay.replace(/-$/, "");
    current.rows.push(row);
    i = j;
  }
  return { accountName, pockets, problems: [...parseProblems, ...verifyJago(pockets)] };
}

/** Running balances and section totals; any mismatch means a row was read wrong. */
export function verifyJago(pockets: JagoPocket[]): string[] {
  const problems: string[] = [];
  for (const p of pockets) {
    let balance = p.previous;
    for (const r of p.rows) {
      balance += r.amount;
      if (balance !== r.balanceAfter) {
        problems.push(`${p.name}: ${r.date} ${r.ref} balance ${r.balanceAfter} but rows add up to ${balance}`);
        balance = r.balanceAfter;
      }
    }
    const inc = p.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const out = -p.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    if (inc !== p.incoming || out !== p.outgoing || balance !== p.closing) {
      problems.push(`${p.name}: totals in ${inc}/${p.incoming}, out ${out}/${p.outgoing}, closing ${balance}/${p.closing}`);
    }
  }
  return problems;
}
