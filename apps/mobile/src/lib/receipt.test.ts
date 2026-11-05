import { expect, test } from "bun:test";

import { claimFileName, receiptUpload, reimburseLocked, resizeFor } from "./receipt";

test("photos are shrunk to 1600 px on the long side, never enlarged", () => {
  expect(resizeFor(4032, 3024)).toEqual({ width: 1600 });
  expect(resizeFor(3024, 4032)).toEqual({ height: 1600 });
  expect(resizeFor(1200, 900)).toBeNull();
  expect(resizeFor(0, 0)).toBeNull();
});

test("upload part and file names", () => {
  expect(receiptUpload("file:///x.jpg")).toEqual({ uri: "file:///x.jpg", name: "struk.jpg", type: "image/jpeg" });
  expect(claimFileName("RB-2026-0001", "pdf")).toBe("RB-2026-0001.pdf");
  expect(claimFileName("../x", "csv")).toBe("___x.csv");
});

test("items in a claim are locked here", () => {
  expect(reimburseLocked("draft")).toBeNull();
  expect(reimburseLocked(null)).toBeNull();
  expect(reimburseLocked("submitted")).toMatch(/claim report/);
  expect(reimburseLocked("payment")).toMatch(/not counted as income/);
});
