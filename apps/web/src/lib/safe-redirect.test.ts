/// <reference types="bun" />
import { expect, test } from "bun:test";

import { safeRedirect } from "./safe-redirect";

const o = "https://arto.example";

test("keeps same-origin paths", () => {
  expect(safeRedirect("/transactions?uncategorized=true#x", o)).toBe("/transactions?uncategorized=true#x");
  expect(safeRedirect(undefined, o)).toBe("/");
});

test("rejects anything that leaves the site", () => {
  for (const t of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "/\t/evil.com", "evil.com"]) expect(safeRedirect(t, o)).toBe("/");
});
