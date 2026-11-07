import { expect, test } from "bun:test";

import { EMPTY, applyCuts, applyJoyoPlan, itemsWithoutCuts, planPageState } from "./plan-state";
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

test("planPageState gives Joyo the overrides and each scenario's items", () => {
  const st: PlanState = { ...EMPTY, monthlyIncome: 1_500_000_000, scenarios: [{ id: "a", name: "Car", slot: 1, blocks: [{ key: "k", kind: "item", item: { type: "oneOff", label: "DP", amount: 5 } }] }] };
  expect(planPageState(st)).toEqual({ monthlyIncome: 1_500_000_000, horizonMonths: 36, scenarios: [{ name: "Car", items: [{ type: "oneOff", label: "DP", amount: 5 }] }] });
});

test("compare_plans from Joyo replaces the scenarios, keeping colour and saved link of a scenario it kept by name", () => {
  const st: PlanState = {
    ...EMPTY,
    scenarios: [
      { id: "a", name: "Car A", slot: 2, savedId: "sv1", blocks: [] },
      { id: "b", name: "Old idea", slot: 1, blocks: [] },
    ],
  };
  const dp = { type: "oneOff", label: "DP", amount: 9 } as const;
  const next = applyJoyoPlan(st, "compare_plans", {
    horizonMonths: 48,
    monthlySpending: 700_000_000,
    scenarios: [
      { name: "Car A", items: [dp] },
      { name: "No change", items: [] },
      { name: "Car B", items: [] },
      { scenarioId: "saved-only" },
    ],
  });
  expect(next.horizonMonths).toBe(48);
  expect(next.monthlySpending).toBe(700_000_000);
  expect(next.scenarios.map((s) => [s.name, s.slot])).toEqual([
    ["Car A", 2],
    ["Car B", 1],
  ]);
  expect(next.scenarios[0]).toMatchObject({ id: "a", savedId: "sv1" });
  expect(next.scenarios[0]!.blocks).toHaveLength(1);
});

test("simulate_plan from Joyo adds or updates one Joyo scenario and leaves the others", () => {
  const st: PlanState = { ...EMPTY, scenarios: [{ id: "a", name: "Mine", slot: 1, blocks: [] }] };
  const once = applyJoyoPlan(st, "simulate_plan", { items: [{ type: "oneOff", label: "Trip", amount: 3 }] });
  expect(once.scenarios.map((s) => s.name)).toEqual(["Mine", "Joyo"]);
  const twice = applyJoyoPlan(once, "simulate_plan", { items: [] });
  expect(twice.scenarios.map((s) => s.name)).toEqual(["Mine", "Joyo"]);
  expect(twice.scenarios[1]!.blocks).toHaveLength(0);
});

test("a plan call without usable scenarios changes nothing but the overrides", () => {
  const st: PlanState = { ...EMPTY, scenarios: [{ id: "a", name: "Mine", slot: 1, blocks: [] }] };
  expect(applyJoyoPlan(st, "compare_plans", { scenarios: [{ scenarioId: "x" }] }).scenarios).toEqual(st.scenarios);
});
