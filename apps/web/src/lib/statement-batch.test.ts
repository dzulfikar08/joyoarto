/// <reference types="bun" />
import { sampleGopayText, sampleJagoText } from "@baroka/api/lib/statements/sample";
import { describe, expect, test } from "bun:test";

import { commitOrder, crossMatches, mapLimit, periodLabel, textKey } from "./statement-batch";
import type { StatementInfo } from "./statement-batch";
import { describeStatement } from "./statement-describe";

const info = (kind: StatementInfo["kind"], from: string | null, gopayRefs: string[] = []): StatementInfo => ({
  kind,
  period: from ? { from, to: from } : null,
  rows: 0,
  gopayRefs,
});

describe("describeStatement", () => {
  test("Jago sample: kind, period, GoPay payments", () => {
    const d = describeStatement(sampleJagoText());
    expect(d.kind).toBe("jago");
    expect(d.period).toEqual({ from: "2026-10-01", to: "2026-10-29" });
    expect(d.rows).toBe(22);
    expect(d.gopayRefs).toHaveLength(6);
  });

  test("GoPay sample: only the payments made from Jago carry a hint (not top-ups' cashback)", () => {
    const d = describeStatement(sampleGopayText());
    expect(d.kind).toBe("gopay");
    expect(d.period?.from).toBe("2026-10-02");
    // Six named payments plus the top-up, all paid with Jago.
    expect(d.gopayRefs).toHaveLength(7);
  });

  test("anything else is unknown", () => {
    expect(describeStatement("Rekening Koran BCA\n01/10 SALDO AWAL")).toEqual({ kind: "unknown", period: null, rows: 0, gopayRefs: [] });
  });
});

test("crossMatches counts the GoPay payments the other files in the batch cover", () => {
  const jago = describeStatement(sampleJagoText());
  const gopay = describeStatement(sampleGopayText());
  const m = crossMatches([
    { key: "j", info: jago },
    { key: "g", info: gopay },
    { key: "x", info: info("unknown", null) },
  ]);
  expect(m.get("j")).toBe(6);
  expect(m.get("g")).toBe(6);
  expect(m.get("x")).toBe(0);
  expect(crossMatches([{ key: "j", info: jago }]).get("j")).toBe(0);
});

test("commitOrder: GoPay first, then Jago, each oldest first", () => {
  const files = [
    { name: "jago-nov", info: info("jago", "2026-11-01") },
    { name: "gopay-oct", info: info("gopay", "2026-10-02") },
    { name: "jago-sep", info: info("jago", "2026-09-01") },
    { name: "gopay-sep", info: info("gopay", "2026-09-03") },
    { name: "jago-oct", info: info("jago", "2026-10-01") },
  ];
  expect(commitOrder(files).map((f) => f.name)).toEqual(["gopay-sep", "gopay-oct", "jago-sep", "jago-oct", "jago-nov"]);
});

test("periodLabel", () => {
  expect(periodLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe("Oct 2026");
  expect(periodLabel({ from: "2026-09-01", to: "2026-10-31" })).toBe("Sep–Oct 2026");
  expect(periodLabel({ from: "2025-12-01", to: "2026-01-31" })).toBe("Dec 2025–Jan 2026");
  expect(periodLabel(null)).toBe("–");
});

test("textKey tells identical texts apart from different ones", () => {
  expect(textKey(sampleJagoText())).toBe(textKey(sampleJagoText()));
  expect(textKey(sampleJagoText())).not.toBe(textKey(sampleGopayText()));
});

test("mapLimit keeps order and the limit", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  expect(out).toEqual([50, 10, 30, 20, 40]);
  expect(peak).toBe(2);
});
