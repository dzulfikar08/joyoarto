// The capture queue, as pure functions over a list of items: what to do with a new notification, what to send
// next, how to retry. store.ts persists the list; sync.ts does the I/O. Kept pure so it is unit-tested.

import { parseNotification, sourceForPackage, type ParsedCapture, type SourceId } from "./parsers";
import type { QuickAddBody } from "../lib/types";

export type CaptureStatus =
  /** Low-confidence parse: waits for the user to check and send. */
  | "review"
  | "queued"
  | "sending"
  | "sent"
  /** Will retry (network/server) when retryAt is set; otherwise needs a fix (bad request). */
  | "failed"
  | "ignored";

export type CaptureItem = {
  /** The native inbox id: notification key + posted time. */
  id: string;
  /** The notification's key (sbn.key); missing on items queued before it was stored (then read from id). */
  key?: string;
  /** Notification.when, when the listener reported it. */
  shownAt?: number;
  /** Idempotency key sent with the quick add; missing on older items (then derived from id). */
  clientRef?: string;
  packageName: string;
  source: SourceId;
  postedAt: number;
  /** Kept on the device only, to show and re-parse; never sent to the server. */
  title: string;
  text: string;
  simulated: boolean;
  parsed: ParsedCapture | null;
  status: CaptureStatus;
  /** Why it was ignored (by the parser or the user). */
  ignoredReason?: string;
  /** The user's fixes, sent instead of the parsed values. */
  edits: { accountId?: string; category?: string; merchant?: string; note?: string; amountText?: string; direction?: "in" | "out" };
  attempts: number;
  retryAt?: number;
  lastError?: string;
  /** Queued but held: the server refused the sign-in. Sent again after the same account signs in. */
  pausedForSignIn?: boolean;
  transactionId?: string;
  /** What the server saved, for the list. */
  sentDisplay?: string;
  sentAccount?: string;
  sentCategory?: string | null;
};

export type InboxItem = { id: string; packageName: string; key: string; postedAt: number; title: string; text: string; simulated: boolean; shownAt?: number };

export type IngestOptions = { accountBySource: Partial<Record<SourceId, string>>; autoSendLowConfidence: boolean };

export const MAX_ITEMS = 500;

/** The notification key of a queue item (older items only have it inside the id, "key|postTime"). */
export function keyOf(item: Pick<CaptureItem, "id" | "key">): string {
  if (item.key) return item.key;
  const bar = item.id.lastIndexOf("|");
  return bar > 0 ? item.id.slice(0, bar) : item.id;
}

/**
 * The same notification shown again: an update or re-alert keeps the app, the key, Notification.when and the text,
 * however much later it comes. A new payment with the same wording gets a new when (or a new key), so two identical
 * coffees two minutes apart are two captures. Without a when (older items), key and text decide.
 */
function isRepeat(o: CaptureItem, n: InboxItem): boolean {
  if (o.packageName !== n.packageName || o.title !== n.title || o.text !== n.text) return false;
  if (keyOf(o) !== (n.key || keyOf({ id: n.id }))) return false;
  return !o.shownAt || !n.shownAt || o.shownAt === n.shownAt;
}

/** Turns inbox items into queue items: parse, skip repeats, pick the status and the default account. */
export function ingest(items: CaptureItem[], inbox: InboxItem[], opts: IngestOptions): CaptureItem[] {
  const out = [...items];
  const ids = new Set(items.map((i) => i.id));
  for (const n of inbox) {
    if (ids.has(n.id)) continue;
    ids.add(n.id);
    const result = parseNotification(n);
    const source = sourceForPackage(n.packageName)?.id ?? (result.ok ? result.capture.source : "other");
    // Apps repost the same notification (update, re-alert): skip it; the queue (MAX_ITEMS) is the history.
    if (out.some((o) => isRepeat(o, n))) continue;
    const key = n.key || keyOf({ id: n.id });
    const shownAt = n.shownAt || undefined;
    const item: CaptureItem = {
      id: n.id,
      key,
      shownAt,
      clientRef: notificationRef(key, shownAt, n.title, n.text),
      packageName: n.packageName,
      source,
      postedAt: n.postedAt,
      title: n.title,
      text: n.text,
      simulated: n.simulated,
      parsed: result.ok ? result.capture : null,
      status: "queued",
      edits: {},
      attempts: 0,
    };
    if (!result.ok) {
      item.status = "ignored";
      item.ignoredReason = result.ignored;
    } else if (result.capture.confidence === "low" && !opts.autoSendLowConfidence) {
      item.status = "review";
    }
    const account = opts.accountBySource[source];
    if (account) item.edits.accountId = account;
    out.push(item);
  }
  return trim(out);
}

/** Keeps the newest MAX_ITEMS, never dropping something still waiting to be sent. */
export function trim(items: CaptureItem[]): CaptureItem[] {
  if (items.length <= MAX_ITEMS) return items;
  const sorted = [...items].sort((a, b) => b.postedAt - a.postedAt);
  const keep = new Set(sorted.slice(0, MAX_ITEMS).map((i) => i.id));
  return items.filter((i) => keep.has(i.id) || i.status === "queued" || i.status === "review" || (i.status === "failed" && i.retryAt));
}

export function due(items: CaptureItem[], now: number): CaptureItem[] {
  return items
    .filter((i) => sendable(i, now, false))
    .sort((a, b) => a.postedAt - b.postedAt);
}

/** 30 s, 1 min, 2 min, … capped at 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

/**
 * clientRef: the notification key, its Notification.when and a hash of the text. A repost of the same notification
 * gives the same ref (the server keeps one transaction); its posted time is left out because a repost changes it.
 */
export function notificationRef(key: string, shownAt: number | undefined, title: string, text: string): string {
  return fitRef(`${key}|${shownAt ?? ""}|${fnv1a(`${title}\n${text}`)}`);
}

/** The stored ref; items queued before refs were stored keep the old id-based one (it may already be on the server). */
export function clientRefOf(item: Pick<CaptureItem, "id" | "clientRef">): string {
  return item.clientRef ?? fitRef(item.id);
}

/** "notif:" + the ref, hashed when longer than the server's 100 chars. */
function fitRef(raw: string): string {
  const ref = `notif:${raw}`;
  return ref.length <= 100 ? ref : `notif:h${fnv1a(raw)}:${raw.slice(-40)}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const KIND_LABEL: Record<string, string> = {
  payment: "Pembayaran",
  transfer: "Transfer",
  incoming: "Uang masuk",
  topup: "Top up",
  refund: "Refund",
  withdrawal: "Tarik tunai",
  other: "Transaksi",
};

const SOURCE_LABEL: Record<SourceId, string> = { jago: "Jago", gopay: "GoPay", other: "Notifikasi" };

/**
 * The quick-add request for an item. Only parsed fields go out: the amount, direction, counterparty and a short
 * description built from them. The notification text itself is never sent.
 */
export function quickAddBody(item: CaptureItem): QuickAddBody | null {
  const p = item.parsed;
  const amountText = item.edits.amountText ?? p?.amountText;
  if (!amountText) return null;
  const direction = item.edits.direction ?? p?.direction ?? "out";
  const merchant = item.edits.merchant ?? p?.counterparty ?? undefined;
  const kind = KIND_LABEL[p?.kind ?? "other"];
  // "Pembayaran ke KOPI KENANGAN (Jago)"; without a name, "Transaksi Jago" (the server derives a merchant from it).
  const description = (merchant ? `${kind} ${direction === "in" ? "dari" : "ke"} ${merchant} (${SOURCE_LABEL[item.source]})` : `${kind} ${SOURCE_LABEL[item.source]}`).slice(0, 500);
  return {
    amountText: amountText.replace(/^[+-]/, ""),
    direction,
    description,
    merchant: merchant?.slice(0, 80),
    accountId: item.edits.accountId,
    category: item.edits.category,
    note: item.edits.note,
    occurredAt: p?.occurredAt ?? new Date(item.postedAt).toISOString(),
    capturedVia: "notification",
    clientRef: clientRefOf(item),
  };
}

export type SendOutcome =
  | { ok: true; transactionId: string; display: string; account: string; category: string | null }
  | { ok: false; message: string; retryable: boolean };

export function applyOutcome(item: CaptureItem, outcome: SendOutcome, now: number): CaptureItem {
  if (outcome.ok) {
    return {
      ...item,
      status: "sent",
      transactionId: outcome.transactionId,
      sentDisplay: outcome.display,
      sentAccount: outcome.account,
      sentCategory: outcome.category,
      lastError: undefined,
      retryAt: undefined,
    };
  }
  const attempts = item.attempts + 1;
  return {
    ...item,
    status: "failed",
    attempts,
    lastError: outcome.message,
    retryAt: outcome.retryable ? now + backoffMs(attempts) : undefined,
  };
}

/** May this item be sent now? Checked again right before sending, since the user can ignore or edit mid-run. */
export function sendable(item: CaptureItem | undefined, now: number, forced: boolean): item is CaptureItem {
  if (!item || item.pausedForSignIn) return false;
  if (item.status === "queued") return true;
  if (item.status !== "failed") return false;
  return forced || (item.retryAt !== undefined && item.retryAt <= now);
}

/** The server refused the sign-in: back to the queue, held until someone signs in again. Not counted as an attempt. */
export function pauseForSignIn(item: CaptureItem): CaptureItem {
  return { ...item, status: "queued", pausedForSignIn: true, retryAt: undefined, lastError: "Waiting for you to sign in again." };
}

/** After the same account signs in again: everything held (and anything an older version failed with a 401) goes. */
export function resumeAfterSignIn(items: CaptureItem[]): CaptureItem[] {
  return items.map((i) =>
    i.pausedForSignIn || (i.status === "failed" && !i.retryAt && i.lastError?.startsWith("The token was not accepted"))
      ? { ...i, status: "queued", pausedForSignIn: undefined, retryAt: undefined, lastError: undefined }
      : i,
  );
}

export function counts(items: CaptureItem[]) {
  const c = { review: 0, queued: 0, sending: 0, sent: 0, failed: 0, ignored: 0 };
  for (const i of items) c[i.status]++;
  return c;
}
