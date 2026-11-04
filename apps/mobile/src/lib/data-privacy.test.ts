import { expect, test } from "bun:test";

import { downloadError, emailConfirmed, exportFileName, exportUrl, nameConfirmed } from "./data-privacy";

test("exports", () => {
  expect(exportUrl("https://app.example/", "json")).toBe("https://app.example/api/account/export");
  expect(exportUrl("https://app.example", "csv")).toBe("https://app.example/api/account/export/transactions.csv");
  expect(exportFileName("json", new Date("2026-11-03T18:00:00Z"))).toBe("joyoarto-export-2026-11-04.json");
  expect(exportFileName("csv", new Date("2026-11-03T10:00:00Z"))).toBe("joyoarto-transactions-2026-11-03.csv");
  expect(downloadError(403, JSON.stringify({ message: "Do this from the JoyoArto web app." }))).toMatch(/Google or Apple/);
  expect(downloadError(500, "<html>")).toBe("Server error 500");
  expect(downloadError(0, "")).toMatch(/No connection/);
});

test("typed confirmations", () => {
  expect(emailConfirmed(" Ana@Example.com ", "ana@example.com")).toBe(true);
  expect(emailConfirmed("ana@example.co", "ana@example.com")).toBe(false);
  expect(emailConfirmed("", null)).toBe(false);
  expect(nameConfirmed(" Keluarga Demo ", "Keluarga Demo")).toBe(true);
  expect(nameConfirmed("keluarga demo", "Keluarga Demo")).toBe(false);
  expect(nameConfirmed("", " ")).toBe(false);
});
