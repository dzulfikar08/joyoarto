/** Same notation as the API's display strings: "Rp 12.500", decimals only when present. */
export function formatMoney(minor: number, currency = "IDR"): string {
  const exp = ["JPY", "KRW"].includes(currency) ? 0 : 2;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = abs % 10 ** exp;
  const symbol = currency === "IDR" ? "Rp" : currency;
  return `${minor < 0 ? "-" : ""}${symbol} ${whole}${frac ? `,${frac.toString().padStart(exp, "0")}` : ""}`;
}

/** "25000" or "25.000" (rupiah, major units) -> minor units. */
export function rupiahToMinor(input: string): number {
  const digits = input.replace(/[^\d-]/g, "");
  return Number(digits || "0") * 100;
}

/** Short rupiah for chart axes, in Indonesian shorthand: 250 rb, 2,5 jt, 1,2 M. */
export function compactMoney(minor: number, currency = "IDR"): string {
  const major = minor / 100;
  const abs = Math.abs(major);
  const sign = major < 0 ? "-" : "";
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  const unit = currency === "IDR" ? ["M", "jt", "rb"] : ["B", "M", "K"];
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9)} ${unit[0]}`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)} ${unit[1]}`;
  if (abs >= 1e3) return `${sign}${fmt(abs / 1e3)} ${unit[2]}`;
  return `${sign}${Math.round(abs)}`;
}

/** Round axis ticks from 0 to at least `max`: steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** "2026-11" -> "November 2026" (or "Nov" with short). */
export function monthLabel(m: string, style: "long" | "short" = "long"): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return style === "long"
    ? d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
}

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The current month in WIB (UTC+7), where Indonesian months turn over. */
export function currentMonthWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
}
