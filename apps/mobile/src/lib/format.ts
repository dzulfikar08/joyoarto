// Money and dates the way the web app shows them (apps/web/src/lib/format.ts): "Rp 12.500", decimals only when present,
// Indonesian shorthand for chart axes, months turning over in WIB. Pure, unit-tested in format.test.ts.

const WIB_MS = 7 * 3_600_000;

function exponentOf(currency: string): number {
  return ["JPY", "KRW"].includes(currency) ? 0 : 2;
}

/** Minor units to "Rp 12.500" / "-Rp 1.250.000,50" (the API's own `display` notation). */
export function formatMoney(minor: number, currency = "IDR"): string {
  const exp = exponentOf(currency);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = abs % 10 ** exp;
  const symbol = currency === "IDR" ? "Rp" : currency;
  return `${minor < 0 ? "-" : ""}${symbol} ${whole}${frac ? `,${frac.toString().padStart(exp, "0")}` : ""}`;
}

/** Short rupiah for chart axes and tight spots: 250 rb, 2,5 jt, 1,2 M. */
export function compactMoney(minor: number, currency = "IDR"): string {
  const major = minor / 10 ** exponentOf(currency);
  const abs = Math.abs(major);
  const sign = major < 0 ? "-" : "";
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  const unit = currency === "IDR" ? ["M", "jt", "rb"] : ["B", "M", "K"];
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9)} ${unit[0]}`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)} ${unit[1]}`;
  if (abs >= 1e3) return `${sign}${fmt(abs / 1e3)} ${unit[2]}`;
  return `${sign}${Math.round(abs)}`;
}

/** Minor units to what a person types: 2500000 -> "25.000". */
export function amountInputText(minor: number | null | undefined, currency = "IDR"): string {
  if (minor === null || minor === undefined) return "";
  const exp = exponentOf(currency);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = abs % 10 ** exp;
  return frac ? `${whole},${frac.toString().padStart(exp, "0")}` : whole;
}

/** Round axis ticks from 0 to at least `max`: steps of 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11" -> "November 2026", or "Nov" with short. */
export function monthLabel(m: string, style: "long" | "short" = "long"): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const name = MONTHS[mo - 1] ?? m;
  return style === "long" ? `${name} ${y}` : name.slice(0, 3);
}

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The current month in WIB (UTC+7), where Indonesian months turn over. */
export function currentMonthWib(now = new Date()): string {
  return new Date(now.getTime() + WIB_MS).toISOString().slice(0, 7);
}

/** Today in WIB as YYYY-MM-DD. */
export function todayWib(now = new Date()): string {
  return new Date(now.getTime() + WIB_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** Last day of a month: "2026-02" -> "2026-02-28". */
export function monthEnd(m: string): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

/** "2026-11-03" -> "Tue 3 Nov" (with the year when it is not `today`'s year). */
export function dayLabel(day: string, today = todayWib()): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
  return day.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${day.slice(0, 4)}`;
}

/** Section title of a transaction list: "Today", "Yesterday", else dayLabel. */
export function daySectionTitle(day: string, today = todayWib()): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayLabel(day, today);
}

export function isDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Signed percentage for deltas: "+12%", "-3,5%", ">999%". */
export function pctText(v: number): string {
  const body = Math.abs(v) >= 1000 ? ">999" : String(Math.abs(Math.round(v * 10) / 10)).replace(".", ",");
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${body}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
