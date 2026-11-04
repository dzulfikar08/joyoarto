import { expect, test } from "bun:test";

import { dedupeKeys } from "./dedupe";

test("identical rows get different keys, re-runs and case/space changes give the same keys", async () => {
  const coffee = { date: "2026-11-03", amount: -1800000, description: "QRIS KOPI" };
  const a = await dedupeKeys("acc", [coffee, coffee]);
  expect(a[0]).not.toBe(a[1]);
  const b = await dedupeKeys("acc", [coffee, { ...coffee, description: " qris  kopi " }]);
  expect(b).toEqual(a);
  const other = await dedupeKeys("other", [coffee]);
  expect(other[0]).not.toBe(a[0]);
});
