import { expect, test } from "bun:test";

import { tabBarBottomOffset, tabContentInset, tabItemHeight, tabLabelScale } from "./tab-bar-metrics";

test("label scale is clamped", () => {
  expect(tabLabelScale(0.8)).toBe(1);
  expect(tabLabelScale(2)).toBe(1.3);
  expect(tabLabelScale(Number.NaN)).toBe(1);
});

test("footprint", () => {
  expect(tabItemHeight(1)).toBe(50);
  expect(tabBarBottomOffset(34, "ios")).toBe(22);
  expect(tabBarBottomOffset(0, "ios")).toBe(8);
  expect(tabBarBottomOffset(24, "android")).toBe(32);
  // strip (20 + 50 + 14) + offset 32 + gap 12
  expect(tabContentInset(1, 24, "android")).toBe(128);
});
