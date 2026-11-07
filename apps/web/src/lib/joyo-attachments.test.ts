import { expect, test } from "bun:test";

import { attachmentKind, attachmentProblem, capText } from "./joyo-attachments";

test("files are sorted into what Joyo can read", () => {
  expect(attachmentKind("brosur.JPG", "")).toBe("image");
  expect(attachmentKind("screenshot.png", "image/png")).toBe("image");
  expect(attachmentKind("simulasi kredit.pdf", "application/pdf")).toBe("pdf");
  expect(attachmentKind("angsuran.csv", "text/csv")).toBe("table");
  expect(attachmentKind("angsuran.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("excel");
  expect(attachmentKind("video.mp4", "video/mp4")).toBeNull();
});

test("spreadsheets, unknown types and big files get a reason", () => {
  expect(attachmentProblem({ name: "a.xlsx", type: "", size: 10 })).toContain("CSV");
  expect(attachmentProblem({ name: "a.mp4", type: "video/mp4", size: 10 })).toContain("PDFs");
  expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toContain("20 MB");
  expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 1000 })).toBeNull();
});

test("long text is cut and says so", () => {
  expect(capText("a\r\nb ")).toBe("a\nb");
  expect(capText("x".repeat(50), 10)).toBe(`${"x".repeat(10)}\n[… cut: the file is longer]`);
});
