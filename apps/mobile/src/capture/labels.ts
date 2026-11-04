import type { CaptureItem, CaptureStatus } from "./queue";

export const STATUS: Record<CaptureStatus, { label: string; tone: "muted" | "primary" | "positive" | "warning" | "destructive" }> = {
  review: { label: "Check", tone: "warning" },
  queued: { label: "Waiting", tone: "primary" },
  sending: { label: "Sending", tone: "primary" },
  sent: { label: "Sent", tone: "positive" },
  failed: { label: "Failed", tone: "destructive" },
  ignored: { label: "Ignored", tone: "muted" },
};

export const SOURCE = { jago: "Jago", gopay: "GoPay", other: "Other" } as const;

export function amountLabel(i: CaptureItem) {
  if (i.sentDisplay) return i.sentDisplay;
  const p = i.parsed;
  if (!p) return "—";
  return `${(i.edits.direction ?? p.direction) === "in" ? "+" : "−"}${i.edits.amountText ?? p.amountText}`;
}

