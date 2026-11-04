// YYYY-MM arithmetic for the planner.

export function addMonths(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Whole months from `from` to `to` (to − from); negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number) as [number, number];
  const [y2, m2] = to.split("-").map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}

/** The `count` complete months before `current`, oldest first. */
export function completeMonthsBefore(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(current, i - count));
}

/** Averages are kept to the whole rupiah (100 minor units): fractions of a rupiah are noise in a plan. */
export function wholeUnits(minor: number): number {
  return Math.round(minor / 100) * 100;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : wholeUnits((s[mid - 1]! + s[mid]!) / 2);
}

export function average(xs: number[]): number {
  return xs.length ? wholeUnits(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}
