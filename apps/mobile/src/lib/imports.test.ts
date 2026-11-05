import { expect, test } from "bun:test";

import { batchSummary, canSave, describeInbound, entryFacts, entryStatus, importLogText, inboundStatus, saveOrder, undoDoneText, type BatchEntry } from "./imports";
import { mockStatementResult } from "../imports/statement-file";
import type { StatementResult } from "./types";

const jago = (commit = false) => mockStatementResult("jago.pdf", commit);
const gopay = (commit = false) => mockStatementResult("gopay.pdf", commit);

test("entry status follows the preview and the save", () => {
  const e: BatchEntry = { key: "1", name: "a.pdf", busy: null };
  expect(entryStatus(e)).toBe("checking");
  expect(entryStatus({ ...e, busy: "saving" })).toBe("saving");
  expect(entryStatus({ ...e, previewError: "x" })).toBe("failed");
  expect(entryStatus({ ...e, previewError: "x", unsupported: true })).toBe("unsupported");
  expect(canSave("unsupported")).toBe(false);
  expect(entryStatus({ ...e, preview: jago() })).toBe("ready");
  const bad = { ...jago(), balancesVerified: false, problems: ["Row 3 does not add up"] } as StatementResult;
  expect(entryStatus({ ...e, preview: bad })).toBe("problems");
  const none = { ...jago(), totals: { ...(jago() as Extract<StatementResult, { kind: "jago" }>).totals, newRows: 0 } } as StatementResult;
  expect(entryStatus({ ...e, preview: none })).toBe("nothing-new");
  expect(entryStatus({ ...e, preview: jago(), saveError: "x" })).toBe("save-failed");
  expect(entryStatus({ ...e, preview: jago(), result: jago(true) })).toBe("saved");
  expect(canSave("ready") && canSave("save-failed") && !canSave("problems")).toBe(true);
});

test("GoPay is saved before Jago, oldest first", () => {
  const at = (key: string, r: StatementResult, from: string): BatchEntry => ({ key, name: key, busy: null, preview: { ...r, period: { from, to: from } } });
  const order = saveOrder([at("j-oct", jago(), "2026-10-01"), at("g-oct", gopay(), "2026-10-01"), at("j-sep", jago(), "2026-09-01"), at("g-sep", gopay(), "2026-09-01")]);
  expect(order.map((e) => e.key)).toEqual(["g-sep", "g-oct", "j-sep", "j-oct"]);
});

test("facts and the combined result", () => {
  expect(entryFacts(jago())).toEqual(["Bank Jago", "1 pocket", "58 rows", "55 new", "3 already in", "4 confirm quick adds"]);
  expect(entryFacts(gopay())[0]).toBe("GoPay");
  const s = batchSummary([jago(true), gopay(true)], ["broken.pdf"]);
  expect(s.title).toBe("Saved 2 statements: 67 new transactions, 3 already in.");
  expect(s.lines).toEqual([
    "28 GoPay payments named after the real merchant.",
    "7 quick adds confirmed by the statement.",
    "1 quick add in these months matched nothing; they stay pending.",
    "6 GoPay payments still wait for the GoPay e-statement of that month.",
    "Not saved: broken.pdf.",
  ]);
});

test("import log and email-in text", () => {
  const row = { id: "i", accountId: "a", source: "csv", fileName: null, periodFrom: "2026-10-01", periodTo: "2026-10-31", insertedCount: 12, duplicateCount: 1 };
  expect(importLogText(row, "BCA")).toEqual({ title: "BCA · csv", subtitle: "2026-10-01 → 2026-10-31 · 12 added, 1 duplicate" });
  expect(importLogText({ ...row, periodFrom: null }, undefined).title).toBe("Unknown account · csv");
  expect(undoDoneText({ removed: 3, restoredToPending: 1 })).toBe("Removed 3; 1 back to pending.");
  expect(inboundStatus("imported").tone).toBe("positive");
  expect(inboundStatus("weird")).toEqual({ label: "weird", tone: "muted" });
  expect(describeInbound("forwarding_confirmation", { code: "123" })).toMatch(/123/);
  expect(describeInbound("partial", { files: [{ name: "a.pdf", ok: true, newRows: 4 }, { name: "b.pdf", ok: false }] })).toBe("a.pdf: 4 new · b.pdf: not imported");
  expect(describeInbound("imported", null)).toBe("");
});
