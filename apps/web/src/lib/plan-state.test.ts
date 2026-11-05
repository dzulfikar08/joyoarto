import { expect, test } from "bun:test";

import { EMPTY, applyCuts, itemsWithoutCuts } from "./plan-state";
import type { CutIn, PlanState } from "./plan-state";

const coffee: CutIn = { type: "cut", id: "cut:food/coffee", label: "Kopi: 3x -> 2x a week", monthly: 12_000_000, habit: "food/coffee" };
const mini: CutIn = { type: "cut", id: "cut:minimarket", label: "Minimarket", monthly: 5_000_000, habit: "minimarket" };

test("cuts go into the chosen scenario and replace the ones added before", () => {
  const st: PlanState = {
    ...EMPTY,
    scenarios: [
      { id: "a", name: "Car", slot: 1, blocks: [{ key: "k1", kind: "item", item: { type: "oneOff", label: "DP", amount: 1 } }, { key: "k2", kind: "item", item: { type: "cut", label: "My own cut", monthly: 1 } }] },
    ],
  };
  const once = applyCuts(st, [coffee], "a", "Hemat");
  expect(once.scenarioId).toBe("a");
  const twice = applyCuts(once.state, [mini], "a", "Hemat").state;
  const labels = twice.scenarios[0]!.blocks.map((b) => (b.kind === "item" ? b.item.label : ""));
  // A cut typed by hand stays; the earlier habit cut is replaced.
  expect(labels).toEqual(["DP", "My own cut", "Minimarket"]);
  expect(itemsWithoutCuts(twice.scenarios[0]!).map((i) => i.label)).toEqual(["DP", "My own cut"]);
  // None chosen: the habit cuts are removed.
  expect(applyCuts(twice, [], "a", "Hemat").state.scenarios[0]!.blocks).toHaveLength(2);
});

test("without a target the cuts become their own scenario, if there is room", () => {
  const r = applyCuts(EMPTY, [coffee, mini], null, "Hemat");
  expect(r.state.scenarios).toHaveLength(1);
  expect(r.state.scenarios[0]!.name).toBe("Hemat");
  expect(r.state.scenarios[0]!.blocks).toHaveLength(2);
  expect(applyCuts(EMPTY, [], null, "Hemat").state.scenarios).toHaveLength(0);
});
