import { describe, expect, test } from "bun:test";

import { applyOutcome, backoffMs, clientRefOf, due, ingest, quickAddBody, type InboxItem } from "./queue";

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
  test("the same id twice, or a repost within two minutes, is one capture", () => {
    const text = "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.";
    const first = ingest([], [inbox("k4|1", text)], opts);
    expect(ingest(first, [inbox("k4|1", text)], opts)).toHaveLength(1);
    const repost = ingest(first, [inbox("k4|2", text, { postedAt: t0 + 30_000 })], opts);
    expect(repost).toHaveLength(2);
    expect(repost[1]!.status).toBe("ignored");
    const later = ingest(first, [inbox("k4|3", text, { postedAt: t0 + 10 * 60_000 })], opts);
    expect(later[1]!.status).toBe("queued");
  });
});

describe("sending", () => {
  const [item] = ingest([], [inbox("0|com.jago.digitalBanking|42|null|10123|1762227000000", "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.")], opts);

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
    expect(body.clientRef).toBe("notif:0|com.jago.digitalBanking|42|null|10123|1762227000000");
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
