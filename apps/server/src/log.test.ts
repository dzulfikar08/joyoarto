import { expect, test } from "bun:test";

import { stripQuery } from "./log";

test("request log lines lose their query strings", () => {
  expect(stripQuery("<-- GET /api/transactions?q=gaji%20istri&from=2026-01-01")).toBe("<-- GET /api/transactions");
  expect(stripQuery("--> GET /api/reports/dashboard?month=2026-11 200 12ms")).toBe("--> GET /api/reports/dashboard 200 12ms");
  expect(stripQuery("--> POST /mcp 200 3ms")).toBe("--> POST /mcp 200 3ms");
});
