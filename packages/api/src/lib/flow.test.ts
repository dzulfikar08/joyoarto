import { describe, expect, test } from "bun:test";

import { band, buildFlow, fitLabel, flowColorSlots, flowColumns, flowOpens, flowPct, layoutFlow } from "./flow";

const NAMES: Record<string, string> = {
  food: "Food & drink",
  "food/groceries": "Groceries",
  "food/dining": "Eating out",
  "food/coffee": "Coffee & snacks",
  "food/delivery": "Food delivery",
  home: "Home & rent",
  "income/salary": "Salary",
  "income/business": "Business income",
};
const name = (s: string) => NAMES[s];

describe("buildFlow", () => {
  test("income to hub to groups and saved; subcategories only for split groups", () => {
    const f = buildFlow({
      income: [{ slug: "income/salary", amount: 1000 }],
      expense: [
        { slug: "home", amount: 400 },
        { slug: "food/groceries", amount: 150 },
        { slug: "food/dining", amount: 50 },
      ],
      name,
    });
    expect(f).toMatchObject({ income: 1000, spending: 600, saved: 400, fromSavings: 0 });
    expect(f.nodes.map((n) => [n.id, n.column, n.amount])).toEqual([
      ["source:income/salary", 0, 1000],
      ["hub", 1, 1000],
      ["group:home", 2, 400],
      ["group:food", 2, 200],
      ["item:food/groceries", 3, 150],
      ["item:food/dining", 3, 50],
      ["saved", 2, 400],
    ]);
    expect(f.nodes.find((n) => n.id === "group:food")?.label).toBe("Food & drink");
    // Every node's links balance: in = out for the hub, groups are split fully.
    const into = (id: string) => f.links.filter((l) => l.target === id).reduce((s, l) => s + l.amount, 0);
    const outOf = (id: string) => f.links.filter((l) => l.source === id).reduce((s, l) => s + l.amount, 0);
    expect(into("hub")).toBe(outOf("hub"));
    expect(outOf("group:food")).toBe(200);
  });

  test("spending above income comes from savings; no saved node", () => {
    const f = buildFlow({ income: [{ slug: "income/salary", amount: 500 }], expense: [{ slug: "home", amount: 800 }], name });
    expect(f).toMatchObject({ saved: 0, fromSavings: 300 });
    expect(f.nodes.find((n) => n.id === "source:savings")?.amount).toBe(300);
    expect(f.nodes.find((n) => n.id === "hub")?.amount).toBe(800);
    expect(f.nodes.some((n) => n.kind === "saved")).toBe(false);
  });

  test("caps groups, items and sources; refunds above spending and duplicates are handled", () => {
    const f = buildFlow({
      income: [
        { slug: "income/salary", amount: 900 },
        { slug: "income/business", amount: 50 },
        { slug: "income/x", amount: 30 },
        { slug: "income/y", amount: 20 },
      ],
      expense: [
        { slug: "food/groceries", amount: 40 },
        { slug: "food/dining", amount: 30 },
        { slug: "food/coffee", amount: 20 },
        { slug: "food/delivery", amount: 10 },
        { slug: "food", amount: 5 },
        { slug: "food", amount: 5 },
        { slug: "a", amount: 9 },
        { slug: "b", amount: 8 },
        { slug: "c", amount: -3 },
        { slug: null, amount: 7 },
      ],
      name,
      groups: 3,
      itemsPerGroup: 3,
      sources: 3,
    });
    expect(f.nodes.filter((n) => n.kind === "source").map((n) => [n.label, n.amount])).toEqual([
      ["Salary", 900],
      ["Business income", 50],
      ["Other income", 50],
    ]);
    expect(f.nodes.filter((n) => n.kind === "group").map((n) => [n.label, n.amount])).toEqual([
      ["Food & drink", 110],
      ["a", 9],
      ["Everything else", 15],
    ]);
    expect(f.nodes.filter((n) => n.group === "group:food").filter((n) => n.kind === "item").map((n) => [n.label, n.amount])).toEqual([
      ["Groceries", 40],
      ["Eating out", 30],
      ["More food & drink", 40],
    ]);
    expect(f.nodes.filter((n) => n.group === "group:rest" && n.kind === "item").map((n) => n.label)).toEqual(["b", "Uncategorized"]);
    expect(f.spending).toBe(134);
  });

  test("an empty month has no nodes", () => {
    expect(buildFlow({ income: [], expense: [], name }).nodes).toEqual([]);
  });
});

describe("layoutFlow", () => {
  const f = buildFlow({
    income: [{ slug: "income/salary", amount: 1000 }],
    expense: [
      { slug: "home", amount: 400 },
      { slug: "food/groceries", amount: 150 },
      { slug: "food/dining", amount: 50 },
    ],
    name,
  });
  const columns = [
    { x: 0, minSlot: 0, gap: 10 },
    { x: 100, minSlot: 30, gap: 10 },
    { x: 200, minSlot: 20, gap: 6 },
  ];

  test("drops columns before `first`, scales to the height and stacks bands on their nodes", () => {
    const l = layoutFlow(f, { columns, first: 1, height: 200, nodeWidth: 4 });
    expect(l.nodes.some((n) => n.kind === "source")).toBe(false);
    const hub = l.nodes.find((n) => n.id === "hub")!;
    // The groups column (3 nodes, 2 gaps of 10) sets the scale.
    expect(hub.h).toBeCloseTo(180, 5);
    const fromHub = l.links.filter((x) => x.source === "hub");
    expect(fromHub.reduce((s, x) => s + x.width, 0)).toBeCloseTo(hub.h, 5);
    // Items follow their group down the chart.
    const food = l.nodes.find((n) => n.id === "group:food")!;
    const groceries = l.nodes.find((n) => n.id === "item:food/groceries")!;
    expect(groceries.y).toBeGreaterThanOrEqual(food.y - 1);
    // Nodes in a column never overlap.
    const col = l.nodes.filter((n) => n.x === 100).sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) expect(col[i]!.y).toBeGreaterThanOrEqual(col[i - 1]!.y + col[i - 1]!.h);
    expect(l.height).toBeGreaterThanOrEqual(200);
  });

  test("band is a closed path between the two ends", () => {
    expect(band(0, 0, 10, 20, 5)).toBe("M0,0 C5,0 5,20 10,20 L10,25 C5,25 5,5 0,5 Z");
  });
});

describe("flowColumns", () => {
  test("compact charts start with the hub at the left edge; items keep room for labels", () => {
    const g = flowColumns(360, { sources: false });
    expect(g.first).toBe(1);
    expect(g.columns.map((c) => c.x)[0]).toBe(0);
    expect(g.columns.length).toBe(3);
    expect(360 - g.columns[2]!.x - g.nodeWidth).toBeGreaterThanOrEqual(104);
  });
  test("with sources the columns go left to right", () => {
    const xs = flowColumns(1000, { sources: true }).columns.map((c) => c.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs.length).toBe(4);
  });
  test("fitLabel", () => {
    expect(fitLabel("Groceries", 200)).toBe("Groceries");
    expect(fitLabel("Zakat, infaq & sedekah", 66)).toBe("Zakat, in…");
  });
});

describe("flow helpers", () => {
  test("colour slots skip the grey groups and give saved its own", () => {
    const slots = flowColorSlots([
      { id: "hub", kind: "hub" },
      { id: "group:food", kind: "group" },
      { id: "group:uncategorized", kind: "group" },
      { id: "group:home", kind: "group" },
      { id: "group:rest", kind: "group" },
      { id: "saved", kind: "saved" },
    ]);
    expect([...slots]).toEqual([
      ["group:food", 0],
      ["group:uncategorized", null],
      ["group:home", 1],
      ["group:rest", null],
      ["saved", "saved"],
    ]);
  });
  test("flowPct and flowOpens", () => {
    expect([flowPct(39, 100), flowPct(6.1, 100), flowPct(0, 100), flowPct(1, 0)]).toEqual(["39%", "6,1%", "0%", "0%"]);
    expect(flowOpens({ id: "item:food:more", kind: "item" })).toBe(false);
    expect(flowOpens({ id: "group:food", kind: "group" })).toBe(true);
    expect(flowOpens({ id: "saved", kind: "saved" })).toBe(false);
  });
});
