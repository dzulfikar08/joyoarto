import { describe, expect, test } from "bun:test";

import { amountToMinor, findAmounts, occurredAtOf } from "./common";
import { ADB_TEST_PACKAGE, parseNotification, sourceForPackage } from "./index";
import { SAMPLES } from "./samples";

const postedAt = Date.UTC(2026, 10, 4, 3, 30); // 2026-11-04 10:30 WIB

describe("samples", () => {
  for (const s of SAMPLES) {
    test(s.name, () => {
      const r = parseNotification({ packageName: s.packageName, title: s.title, text: s.text, postedAt });
      if ("ignored" in s.expect) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.ignored).toBe(s.expect.ignored);
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.capture.direction).toBe(s.expect.direction);
      expect(r.capture.amountMinor).toBe(s.expect.amountMinor);
      expect(r.capture.counterparty).toBe(s.expect.counterparty);
      if (s.expect.kind) expect(r.capture.kind).toBe(s.expect.kind as never);
      if (s.expect.confidence) expect(r.capture.confidence).toBe(s.expect.confidence);
    });
  }
});

describe("amounts", () => {
  test("Indonesian and English separators, shorthand", () => {
    expect(amountToMinor("25.000")).toBe(2_500_000);
    expect(amountToMinor("1.250.000,50")).toBe(125_000_050);
    expect(amountToMinor("25,000.00")).toBe(2_500_000);
    expect(amountToMinor("1,5", "jt")).toBe(150_000_000);
    expect(amountToMinor("15", "rb")).toBe(1_500_000);
    expect(amountToMinor("1.250", "rb")).toBe(125_000_000);
  });
  test("finds every Rp/IDR amount in order", () => {
    expect(findAmounts("Transfer Rp200.000 biaya Rp2.500, saldo IDR 1,000,000.00").map((a) => a.minor)).toEqual([
      20_000_000, 250_000, 100_000_000,
    ]);
  });
});

describe("time", () => {
  test("a printed WIB time wins over the post time", () => {
    expect(occurredAtOf("pada 04/11/2026 10:21 WIB", postedAt)).toBe("2026-11-04T03:21:00.000Z");
    expect(occurredAtOf("4 Nov 2026 09.05", postedAt)).toBe("2026-11-04T02:05:00.000Z");
  });
  test("no date, or a date far away (a due date), uses the post time", () => {
    expect(occurredAtOf("Pembayaran berhasil", postedAt)).toBe(new Date(postedAt).toISOString());
    expect(occurredAtOf("jatuh tempo 25/12/2026", postedAt)).toBe(new Date(postedAt).toISOString());
  });
});

describe("routing", () => {
  test("known packages map to their source", () => {
    expect(sourceForPackage("com.jago.digitalBanking")?.id).toBe("jago");
    expect(sourceForPackage("com.gojek.app")?.id).toBe("gopay");
    expect(sourceForPackage("com.gojek.gopay")?.id).toBe("gopay");
    expect(sourceForPackage("com.whatsapp")).toBeNull();
  });
  test("an unknown package (adb test) tries every parser and keeps the confident one", () => {
    const r = parseNotification({ packageName: ADB_TEST_PACKAGE, title: "Pembayaran berhasil", text: "Pembayaran ke KOPI KENANGAN sebesar Rp25.000 berhasil.", postedAt });
    expect(r.ok && r.capture.confidence).toBe("high");
    expect(r.ok && r.capture.counterparty).toBe("KOPI KENANGAN");
  });
});
