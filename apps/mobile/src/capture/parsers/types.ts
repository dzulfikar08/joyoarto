export type SourceId = "jago" | "gopay" | "other";

export type Direction = "in" | "out";

/** What kind of money movement the notification describes. */
export type CaptureKind = "payment" | "transfer" | "incoming" | "topup" | "refund" | "withdrawal" | "other";

export type Confidence = "high" | "low";

export type ParsedCapture = {
  source: SourceId;
  kind: CaptureKind;
  direction: Direction;
  /** As printed, e.g. "Rp25.000"; sent to the server as amountText. */
  amountText: string;
  /** Absolute value in minor units (IDR: Rp 25.000 = 2500000), for display and checks only. */
  amountMinor: number;
  /** Merchant or person on the other side, as printed; null when the text does not say. */
  counterparty: string | null;
  /** ISO instant: a time printed in the text when there is one, else when the notification was posted. */
  occurredAt: string;
  confidence: Confidence;
  /** Why the parse is low-confidence (empty when high). */
  doubts: string[];
};

export type ParseResult =
  | { ok: true; capture: ParsedCapture }
  /** Not a transaction (OTP, promo, failed payment, own-pocket move, no amount). Nothing is sent. */
  | { ok: false; ignored: string };

export type NotificationInput = {
  packageName: string;
  title: string;
  text: string;
  /** Epoch ms. */
  postedAt: number;
};

/** A source-specific parser: return null when the text is not one of its formats, so the generic one can try. */
export type SourceParser = (n: NotificationInput) => ParseResult | null;
