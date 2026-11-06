/** A request log line without query strings ("<-- GET /api/transactions?q=gaji" → "<-- GET /api/transactions"). */
export function stripQuery(line: string): string {
  return line.replace(/\?\S*/g, "");
}
