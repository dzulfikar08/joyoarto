import { expect, test } from "bun:test";

import { NUM_FONTS, TEXT_FONTS, numericFamily, wantsFigures } from "./fonts";

test("figures use Inter at the same weight; other faces are left alone", () => {
  expect(numericFamily(TEXT_FONTS.heavy)).toBe(NUM_FONTS.heavy);
  expect(numericFamily(TEXT_FONTS.regular)).toBe(NUM_FONTS.regular);
  expect(numericFamily("Menlo")).toBe("Menlo");
  expect(numericFamily(undefined)).toBeUndefined();
});

test("only tabular-nums asks for figures", () => {
  expect(wantsFigures({ fontVariant: ["tabular-nums"] })).toBe(true);
  expect(wantsFigures({ fontVariant: ["small-caps"] })).toBe(false);
  expect(wantsFigures({ fontVariant: "lining-nums tabular-nums" })).toBe(true);
  expect(wantsFigures(null)).toBe(false);
});
