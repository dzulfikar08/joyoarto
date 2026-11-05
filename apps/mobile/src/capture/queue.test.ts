import { describe, expect, test } from "bun:test";

import { applyOutcome, backoffMs, clientRefOf, due, ingest, pauseForSignIn, quickAddBody, resumeAfterSignIn, sendable, type InboxItem } from "./queue";

const t0 = Date.UTC(2026, 10, 4, 3, 30);
const opts = { accountBySource: { jago: "acc_jago" }, autoSendLowConfidence: false };

function inbox(id: string, text: string, extra: Partial<InboxItem> = {}): InboxItem {
  return { id, packageName: "com.jago.digitalBanking", key: id, postedAt: t0, title: "Pembayaran berhasil", text, simulated: false, ...extra };
}

describe("ingest", () => {
  test("a confident parse is queued with the source's account", () => {
    const [item] = ingest([], [inbox("k1|1", "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.")], opts);
    expect(item!.status).toBe("queued");
    expect(item!.edits.accountId).toBe("acc_jago");
    expect(item!.parsed?.amountMinor).toBe(2_500_000);
  });
  test("low confidence waits for review unless auto-send is on", () => {
    const n = inbox("k2|1", "Ada transaksi Rp75.000 di rekening kamu.", { title: "Info" });
    expect(ingest([], [n], opts)[0]!.status).toBe("review");
    expect(ingest([], [n], { ...opts, autoSendLowConfidence: true })[0]!.status).toBe("queued");
  });
  test("non-transactions are ignored with the reason", () => {
    const [item] = ingest([], [inbox("k3|1", "Kode OTP kamu 123456.")], opts);
    expect(item!.status).toBe("ignored");
    expect(item!.ignoredReason).toBe("verification code");
  });
  test("the same id twice is one capture", () => {
    const text = "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.";
    const first = ingest([], [inbox("k4|1", text)], opts);
    expect(ingest(first, [inbox("k4|1", text)], opts)).toHaveLength(1);
  });
  test("a repost of the same notification (same key, when and text) is skipped however late it comes", () => {
    const text = "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.";
    const first = ingest([], [inbox("k5|1", text, { key: "k5", shownAt: t0 })], opts);
    const later = ingest(first, [inbox("k5|2", text, { key: "k5", shownAt: t0, postedAt: t0 + 3 * 3_600_000 })], opts);
    expect(later).toHaveLength(1);
    // Without Notification.when (older listener), the key and the text decide.
    const old = ingest([], [inbox("k6|1", text, { key: "k6" })], opts);
    expect(ingest(old, [inbox("k6|2", text, { key: "k6", postedAt: t0 + 10 * 60_000 })], opts)).toHaveLength(1);
  });
  test("two real identical payments are two captures, even seconds apart", () => {
    const text = "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.";
    // An app that reuses its notification id: the key is the same, Notification.when is not.
    const a = ingest([], [inbox("k7|1", text, { key: "k7", shownAt: t0 })], opts);
    const b = ingest(a, [inbox("k7|2", text, { key: "k7", shownAt: t0 + 20_000, postedAt: t0 + 20_000 })], opts);
    expect(b.map((i) => i.status)).toEqual(["queued", "queued"]);
    expect(clientRefOf(b[0]!)).not.toBe(clientRefOf(b[1]!));
    // Different keys (a new notification id per payment).
    const c = ingest([], [inbox("k8|1", text, { key: "k8" }), inbox("k9|1", text, { key: "k9", postedAt: t0 + 5_000 })], opts);
    expect(c.map((i) => i.status)).toEqual(["queued", "queued"]);
  });
  test("clientRef is the same for a repost and leaves out the posted time", () => {
    const text = "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.";
    const [x] = ingest([], [inbox("k10|1", text, { key: "k10", shownAt: t0 })], opts);
    const [y] = ingest([], [inbox("k10|999", text, { key: "k10", shownAt: t0, postedAt: t0 + 3_600_000 })], opts);
    expect(clientRefOf(x!)).toBe(clientRefOf(y!));
    const [z] = ingest([], [inbox("k10|1", "Pembayaran ke KOPI KENANGAN sebesar Rp30.000 berhasil.", { key: "k10", shownAt: t0 })], opts);
    expect(clientRefOf(z!)).not.toBe(clientRefOf(x!));
  });
});

describe("sending", () => {
  const [item] = ingest([], [inbox("0|com.jago.digitalBanking|42|null|10123|1762227000000", "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.", { key: "0|com.jago.digitalBanking|42|null|10123" })], opts);

  test("the request carries parsed fields only, never the notification text", () => {
    const body = quickAddBody(item!)!;
    expect(body).toMatchObject({
      amountText: "Rp25.000",
      direction: "out",
      merchant: "KOPI KENANGAN",
      accountId: "acc_jago",
      capturedVia: "notification",
      description: "Pembayaran ke KOPI KENANGAN (Jago)",
    });
    expect(JSON.stringify(body)).not.toContain("sebesar");
    expect(body.clientRef).toMatch(/^notif:0\|com\.jago\.digitalBanking\|42\|null\|10123\|\|[0-9a-z]+$/);
    // An item queued before refs were stored keeps the id-based one.
    expect(clientRefOf({ id: item!.id })).toBe("notif:0|com.jago.digitalBanking|42|null|10123|1762227000000");
  });
  test("user fixes win over the parse", () => {
    const body = quickAddBody({ ...item!, edits: { accountId: "acc_other", category: "food/coffee", merchant: "Kopi Kenangan" } })!;
    expect(body).toMatchObject({ accountId: "acc_other", category: "food/coffee", merchant: "Kopi Kenangan" });
  });
  test("long keys are hashed to fit 100 characters, deterministically", () => {
    const id = `${"x".repeat(150)}|1762227000000`;
    expect(clientRefOf({ id }).length).toBeLessThanOrEqual(100);
    expect(clientRefOf({ id })).toBe(clientRefOf({ id }));
    expect(clientRefOf({ id })).not.toBe(clientRefOf({ id: `y${id}` }));
  });
  test("retryable failures back off; others wait for a fix", () => {
    const failed = applyOutcome(item!, { ok: false, message: "No connection", retryable: true }, t0);
    expect(failed.status).toBe("failed");
    expect(failed.retryAt).toBe(t0 + 30_000);
    expect(due([failed], t0)).toHaveLength(0);
    expect(due([failed], t0 + 30_000)).toHaveLength(1);
    const bad = applyOutcome(item!, { ok: false, message: "Account not found", retryable: false }, t0);
    expect(bad.retryAt).toBeUndefined();
    expect(due([bad], t0 + 1e9)).toHaveLength(0);
    expect(backoffMs(20)).toBe(6 * 3_600_000);
  });
  test("success records the transaction", () => {
    const sent = applyOutcome(item!, { ok: true, transactionId: "tx1", display: "-Rp 25.000", account: "Jago", category: null }, t0);
    expect(sent).toMatchObject({ status: "sent", transactionId: "tx1" });
    expect(due([sent], t0)).toHaveLength(0);
  });
});

describe("sign-in pause and mid-run checks", () => {
  const [item] = ingest([], [inbox("k20|1", "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.")], opts);

  test("a refused sign-in keeps the capture queued but held, without counting an attempt", () => {
    const held = pauseForSignIn({ ...item!, status: "sending" });
    expect(held).toMatchObject({ status: "queued", pausedForSignIn: true, attempts: 0 });
    expect(due([held], t0 + 1e9)).toHaveLength(0);
    expect(sendable(held, t0, true)).toBe(false);
    const [resumed] = resumeAfterSignIn([held]);
    expect(resumed).toMatchObject({ status: "queued", pausedForSignIn: undefined, lastError: undefined });
    expect(due([resumed!], t0)).toHaveLength(1);
  });
  test("items an older version failed with a 401 are resumed too; other failures are left alone", () => {
    const old401 = applyOutcome(item!, { ok: false, message: "The token was not accepted. Create a new one…", retryable: false }, t0);
    const bad = applyOutcome(item!, { ok: false, message: "Account not found", retryable: false }, t0);
    const [a, b] = resumeAfterSignIn([old401, bad]);
    expect(a!.status).toBe("queued");
    expect(b!.status).toBe("failed");
  });
  test("an item ignored or sent mid-run is not sent; a forced failed one is", () => {
    expect(sendable({ ...item!, status: "ignored" }, t0, true)).toBe(false);
    expect(sendable({ ...item!, status: "sent" }, t0, true)).toBe(false);
    expect(sendable({ ...item!, status: "review" }, t0, false)).toBe(false);
    expect(sendable(undefined, t0, false)).toBe(false);
    const failed = applyOutcome(item!, { ok: false, message: "Account not found", retryable: false }, t0);
    expect(sendable(failed, t0, false)).toBe(false);
    expect(sendable(failed, t0, true)).toBe(true);
  });
});
