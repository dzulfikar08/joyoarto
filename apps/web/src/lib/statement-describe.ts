// What a statement file is, from its text, with the same parsers the server uses. Loaded lazily with pdf.js.

import { parseGopay } from "@baroka/api/lib/statements/gopay";
import { parseJago } from "@baroka/api/lib/statements/jago";
import { statementKind } from "@baroka/api/lib/statements/summary";

import type { StatementInfo } from "./statement-batch";

export function describeStatement(text: string): StatementInfo {
  const kind = statementKind(text);
  if (kind === "jago") {
    const s = parseJago(text);
    const rows = s.pockets.flatMap((p) => p.rows);
    return { kind, period: span(rows.map((r) => r.date)), rows: rows.length, gopayRefs: rows.map((r) => r.gopayRef).filter((x): x is string => !!x) };
  }
  if (kind === "gopay") {
    const s = parseGopay(text);
    // Same selection as the service: money rows (not cashback) paid from Jago carry the hint.
    const viaBank = s.rows.filter((r) => r.amount !== null && !/^Cashback\b/i.test(r.name) && /Jago/i.test(r.method));
    return { kind, period: span(s.rows.map((r) => r.date)), rows: s.rows.length, gopayRefs: viaBank.map((r) => r.id) };
  }
  return { kind, period: null, rows: 0, gopayRefs: [] };
}

function span(dates: string[]): StatementInfo["period"] {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0]!, to: sorted[sorted.length - 1]! };
}
