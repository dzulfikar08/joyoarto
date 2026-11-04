import { parseWith } from "./common";
import { parseGopay } from "./gopay";
import { parseJago } from "./jago";
import type { NotificationInput, ParseResult, SourceId, SourceParser } from "./types";

export type { CaptureKind, Confidence, Direction, NotificationInput, ParsedCapture, ParseResult, SourceId } from "./types";

export type Source = {
  id: SourceId;
  label: string;
  /** Android package ids whose notifications this source reads. */
  packages: string[];
  parse: SourceParser;
};

/**
 * Allow-listable apps. Package ids were checked against store listings (Nov 2026). To support another app:
 * add a parser file with KNOWN patterns and samples in a test, then an entry here.
 */
export const SOURCES: Source[] = [
  { id: "jago", label: "Bank Jago", packages: ["com.jago.digitalBanking"], parse: parseJago },
  { id: "gopay", label: "GoPay (Gojek, GoPay app)", packages: ["com.gojek.app", "com.gojek.gopay"], parse: parseGopay },
];

/** adb `cmd notification post` notifications come from the shell package; debug builds can allow-list it. */
export const ADB_TEST_PACKAGE = "com.android.shell";

export function sourceForPackage(packageName: string): Source | null {
  return SOURCES.find((s) => s.packages.includes(packageName)) ?? null;
}

const generic: SourceParser = (n) => parseWith(n, "other", { known: [] });

/**
 * Parses one notification. A known app uses its own parser; anything else (a package added by hand, adb tests)
 * tries every parser and keeps the most confident result.
 */
export function parseNotification(n: NotificationInput): ParseResult {
  const source = sourceForPackage(n.packageName);
  if (source) return source.parse(n) ?? generic(n)!;
  const results = [...SOURCES.map((s) => s.parse(n)), generic(n)].filter((r): r is ParseResult => r !== null);
  const ok = results.filter((r) => r.ok);
  const best = ok.find((r) => r.capture.confidence === "high") ?? ok[0];
  if (best) return best;
  return results[0] ?? { ok: false, ignored: "no amount" };
}
