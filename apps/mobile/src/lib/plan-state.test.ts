import { describe, expect, test } from "bun:test";

import {
  addScenario,
  babyBlock,
  blocksFromSaved,
  carBlock,
  compareInput,
  downPaymentHint,
  downPaymentPctHint,
  draftFor,
  duplicateNames,
  duplicateScenario,
  effectiveBaseline,
  EMPTY_PLAN,
  flatten,
  freeSlot,
  habitLabel,
  isHabitCut,
  isDirty,
  itemWhen,
  markDeleted,
  markSaved,
  moneyText,
  newCut,
  nextCarLabel,
  numText,
  openSaved,
  parseMoneyText,
  parseNumText,
  patchSale,
  quickStart,
  regenerateBaby,
  removeScenario,
  saveLabel,
  savePayload,
  setDownPayment,
  setDownPaymentPct,
  setInstallment,
  setResalePct,
  setRole,
  shiftBaby,
  signedAmount,
  savingsInput,
  slotOf,
  suggestionText,
  tenorChoices,
  tickMonths,
  toggleSale,
  upgradeBlocks,
  yearChoices,
  type BabyBlock,
  type Block,
  type LoanIn,
  type PlanState,
  type Scenario,
} from "./plan-state";

const START = "2026-12";
const loanOf = (s: Scenario, i = 0) => flatten(s).filter((x) => x.type === "loan")[i] as LoanIn;

describe("templates", () => {
  test("quick start: two cars with a baby in six months, and a baby without a car", () => {
    const sc = quickStart(START);
    expect(sc.map((s) => [s.name, s.slot])).toEqual([
      ["Car A + baby", 1],
      ["Car B + baby", 2],
      ["Baby, no car", 3],
    ]);
    const car = loanOf(sc[0]!);
    expect([car.label, car.month, car.downPaymentPct, car.tenorMonths, car.ratePct, car.rateType]).toEqual(["Car A", START, 30, 48, 5, "flat"]);
    const baby = sc[0]!.blocks[1] as BabyBlock;
    expect(baby.birthMonth).toBe("2027-06");
    expect(baby.items.some((i) => i.type === "oneOff" && i.label.startsWith("Birth"))).toBe(true);
  });

  test("car upgrade path: the first loan is sold, the second bought in the sale month", () => {
    const [small, big] = upgradeBlocks(START, 18).map((b) => (b.kind === "loan" ? b.item : null));
    expect(small?.sale?.afterMonths).toBe(18);
    expect(big?.month).toBe("2028-06");
  });

  test("baby: moving the birth keeps edited amounts; caesarean regenerates", () => {
    const b = babyBlock("2027-06");
    const edited: BabyBlock = { ...b, items: b.items.map((i) => (i.type === "oneOff" && i.label.startsWith("Birth") ? { ...i, amount: 999_00 } : i)) };
    const moved = shiftBaby(edited, "2027-09");
    const birth = moved.items.find((i) => i.type === "oneOff" && i.label.startsWith("Birth"));
    expect(birth).toMatchObject({ month: "2027-09", amount: 999_00 });
    const checkups = moved.items.find((i) => i.type === "recurring" && i.label === "Pregnancy check-ups");
    expect(checkups).toMatchObject({ startMonth: "2027-03", endMonth: "2027-08" });
    const caesar = regenerateBaby(moved, true, true);
    expect(caesar.items.find((i) => i.label === "Birth (caesarean)")).toBeDefined();
    expect(caesar.items.some((i) => i.label?.startsWith("Caregiver"))).toBe(true);
  });

  test("next car label counts loans", () => {
    expect(nextCarLabel({ blocks: [] })).toBe("Car A");
    expect(nextCarLabel({ blocks: [carBlock(START, "x"), babyBlock(START)] })).toBe("Car B");
  });
});

describe("scenarios on the page", () => {
  test("colour slots stay with their scenario; at most six", () => {
    let st: PlanState = { ...EMPTY_PLAN, scenarios: quickStart(START) };
    st = removeScenario(st, st.scenarios[0]!.id);
    expect(freeSlot(st.scenarios)).toBe(1);
    st = addScenario(st);
    expect(st.scenarios.at(-1)).toMatchObject({ name: "Scenario 3", slot: 1 });
    for (let i = 0; i < 5; i++) st = addScenario(st);
    expect(st.scenarios).toHaveLength(6);
    expect(duplicateScenario(st, st.scenarios[0]!.id).scenarios).toHaveLength(6);
  });

  test("duplicate goes right after, unsaved, with its own copy of the blocks", () => {
    const base: PlanState = { ...EMPTY_PLAN, scenarios: [{ ...quickStart(START)[0]!, savedId: "s1", savedSig: "x" }] };
    const st = duplicateScenario(base, base.scenarios[0]!.id);
    const copy = st.scenarios[1]!;
    expect(copy.name).toBe("Car A + baby (copy)");
    expect(copy.savedId).toBeUndefined();
    expect(copy.slot).toBe(2);
    (copy.blocks[0] as { item: LoanIn }).item.price = 1;
    expect(loanOf(st.scenarios[0]!).price).toBe(0);
  });

  test("dirty only after a change to a saved card", () => {
    const s = quickStart(START)[2]!;
    expect(saveLabel(s)).toBe("Save");
    let st = markSaved({ ...EMPTY_PLAN, scenarios: [s] }, s.id, { id: "srv1", name: "Baby, no car" });
    expect(isDirty(st.scenarios[0]!)).toBe(false);
    expect(saveLabel(st.scenarios[0]!)).toBe("Saved");
    st = { ...st, scenarios: st.scenarios.map((x) => ({ ...x, name: "Baby later" })) };
    expect(saveLabel(st.scenarios[0]!)).toBe("Save changes");
    st = markDeleted(st, "srv1");
    expect(st.scenarios[0]!.savedId).toBeUndefined();
  });

  test("duplicate names are reported (results are matched by name)", () => {
    const [a, b] = quickStart(START);
    expect(duplicateNames([a!, { ...b!, name: a!.name }])).toEqual(["Car A + baby"]);
    expect(duplicateNames([{ ...a!, name: " " }, { ...b!, name: "" }])).toEqual(["Untitled"]);
    expect(slotOf("Car B + baby", [a!, b!])).toBe(2);
    expect(slotOf("No change", [a!, b!])).toBeNull();
  });
});

describe("server inputs", () => {
  test("compare: overrides only when set, every scenario flattened, plus No change", () => {
    expect(compareInput(EMPTY_PLAN)).toBeNull();
    const sc = quickStart(START);
    const st: PlanState = { ...EMPTY_PLAN, monthlyIncome: 20_000_000_00, roles: { acc1: "goal" }, horizonMonths: 24, scenarios: [{ ...sc[0]!, name: "  " }, sc[2]!] };
    const input = compareInput(st)!;
    expect(input).toMatchObject({ monthlyIncome: 20_000_000_00, roles: { acc1: "goal" }, horizonMonths: 24, includeBaseline: true });
    expect("monthlySpending" in input).toBe(false);
    expect(input.scenarios.map((s) => s.name)).toEqual(["Untitled", "Baby, no car"]);
    expect(input.scenarios[0]!.items).toHaveLength(1 + (sc[0]!.blocks[1] as BabyBlock).items.length);
  });

  test("save: the web's view shape, id when it was saved before", () => {
    const s = { ...quickStart(START)[0]!, savedId: "srv9" };
    const p = savePayload({ ...EMPTY_PLAN, monthlySpending: 5_000_000_00, scenarios: [s] }, s);
    expect(p).toMatchObject({ id: "srv9", name: "Car A + baby", plan: { monthlySpending: 5_000_000_00, horizonMonths: 36, roles: {} }, view: { v: 1 } });
    expect(p.view.blocks).toBe(s.blocks);
    expect(p.plan.items).toEqual(flatten(s));
    expect("id" in savePayload(EMPTY_PLAN, quickStart(START)[1]!)).toBe(false);
  });

  test("open saved: blocks from its view, else one per item; baseline numbers come along only to an unedited page", () => {
    const blocks = quickStart(START)[0]!.blocks;
    const saved = { id: "srv1", name: "Car A + baby", plan: { items: flatten({ blocks }), monthlyIncome: 30_000_000_00, horizonMonths: 48 }, view: { v: 1, blocks } };
    const r = openSaved(EMPTY_PLAN, saved);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.monthlyIncome).toBe(30_000_000_00);
    expect(r.state.horizonMonths).toBe(48);
    expect(r.keptPageBaseline).toBe(false);
    expect(r.state.scenarios[0]!.blocks.map((b) => b.kind)).toEqual(["loan", "baby"]);
    expect(isDirty(r.state.scenarios[0]!)).toBe(false);

    const edited = openSaved({ ...EMPTY_PLAN, monthlyIncome: 1 }, saved);
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.state.monthlyIncome).toBe(1);
    expect(edited.keptPageBaseline).toBe(true);

    const fromClaude = blocksFromSaved(flatten({ blocks }), null);
    expect(fromClaude.map((b) => b.kind)).toEqual(["loan", ...Array((blocks[1] as BabyBlock).items.length).fill("item")]);

    const full: PlanState = { ...EMPTY_PLAN, scenarios: Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: String(i), slot: i + 1, blocks: [] })) };
    expect(openSaved(full, saved).ok).toBe(false);
  });
});

describe("baseline", () => {
  const b = {
    income: { recurring: { amount: 20_000_000_00 } },
    spending: { monthly: { amount: 12_000_000_00 } },
    existingInstallments: { monthly: { amount: 1_000_000_00 } },
    accounts: [
      { id: "a", suggestedRole: "emergency" as const, balance: { amount: 50_000_000_00 } },
      { id: "b", suggestedRole: "spending" as const, balance: { amount: 5_000_000_00 } },
    ],
  };

  test("ledger numbers, overrides and roles", () => {
    expect(effectiveBaseline(b, EMPTY_PLAN)).toMatchObject({ free: 7_000_000_00, totals: { emergency: 50_000_000_00, goal: 0, spending: 5_000_000_00 }, edited: false, empty: false });
    let st = setRole(EMPTY_PLAN, "a", "goal", "emergency");
    st = { ...st, monthlySpending: 15_000_000_00 };
    expect(effectiveBaseline(b, st)).toMatchObject({ free: 4_000_000_00, totals: { emergency: 0, goal: 50_000_000_00 }, edited: true });
    expect(setRole(st, "a", "emergency", "emergency").roles).toEqual({});
    expect(effectiveBaseline(b, setRole(EMPTY_PLAN, "b", "exclude", "spending")).totals.spending).toBe(0);
  });
});

describe("form fields", () => {
  test("money: thousands dots, digits only, empty is not set", () => {
    expect(moneyText(undefined)).toBe("");
    expect(moneyText(150_000_000)).toBe("1.500.000");
    expect(moneyText(0)).toBe("0");
    expect(parseMoneyText("Rp 1.500.000")).toBe(150_000_000);
    expect(parseMoneyText("")).toBeUndefined();
    expect(parseMoneyText("abc")).toBeUndefined();
  });

  test("numbers: Indonesian comma, empty, junk", () => {
    expect(parseNumText("2,5")).toBe(2.5);
    expect(parseNumText("47")).toBe(47);
    expect(parseNumText("")).toBeUndefined();
    expect(parseNumText("1.2.3")).toBeNull();
    expect(parseNumText("-3")).toBeNull();
    expect(numText(2.5)).toBe("2,5");
    expect(numText(undefined)).toBe("");
  });

  test("loan: down payment percent and amount exclude each other; installment replaces the rate", () => {
    const l = carBlock(START, "Car", 300_000_000_00);
    if (l.kind !== "loan") throw new Error();
    const byAmount = setDownPayment(l.item, 90_000_000_00);
    expect([byAmount.downPayment, byAmount.downPaymentPct]).toEqual([90_000_000_00, undefined]);
    expect(downPaymentPctHint(byAmount)).toBe(30);
    const byPct = setDownPaymentPct(byAmount, 120);
    expect([byPct.downPayment, byPct.downPaymentPct]).toEqual([undefined, 100]);
    expect(downPaymentHint(setDownPaymentPct(l.item, 20))).toBe(60_000_000_00);
    expect(setDownPayment(byAmount, undefined).downPaymentPct).toBeUndefined();
    const quoted = setInstallment({ ...l.item, ratePct: undefined }, 4_950_000_00);
    expect(quoted.installment).toBe(4_950_000_00);
    expect(setInstallment(quoted, undefined).ratePct).toBe(0);
    expect(setInstallment(l.item, undefined).ratePct).toBe(5);
  });

  test("loan sale terms: on, patch, resale percent clears the amount, off", () => {
    const l = (carBlock(START, "Car", 181_000_000_00) as { item: LoanIn }).item;
    const on = toggleSale(l, true);
    expect(on.sale).toEqual({ afterMonths: 18 });
    const patched = patchSale({ ...on, sale: { afterMonths: 18, resaleAmount: 100_00 } }, { afterMonths: 24 });
    expect(patched.sale).toEqual({ afterMonths: 24, resaleAmount: 100_00 });
    expect(setResalePct(patched, 55).sale).toEqual({ afterMonths: 24, resalePct: 55, resaleAmount: undefined });
    expect(toggleSale(patched, false).sale).toBeUndefined();
  });

  test("income change sign, tenors, years", () => {
    expect(signedAmount(2_000_000_00, true)).toBe(-2_000_000_00);
    expect(signedAmount(undefined, false)).toBe(0);
    expect(tenorChoices(48)).toEqual([12, 24, 36, 48, 60, 72, 84]);
    expect(tenorChoices(47)).toEqual([12, 24, 36, 47, 48, 60, 72, 84]);
    expect(yearChoices("2026-11")).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    expect(yearChoices("2026-11", "2040-01").at(-1)).toBe(2040);
  });

  test("item lines and chart ticks", () => {
    const rp = (m: number) => `Rp ${m / 100}`;
    expect(itemWhen({ type: "oneOff", label: "x", month: "2027-01", amount: 1 }, rp)).toBe("once, 2027-01");
    expect(itemWhen({ type: "recurring", label: "x", startMonth: "2027-01", monthly: 1, rampTo: 800_00 }, rp)).toBe("monthly from 2027-01, rising to Rp 800");
    const months = Array.from({ length: 36 }, (_, i) => `m${i}`);
    expect(tickMonths(months, 5)).toEqual(["m0", "m8", "m16", "m24", "m32"]);
    expect(tickMonths(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("the draft on this phone", () => {
  const state: PlanState = { ...EMPTY_PLAN, monthlyIncome: 5, scenarios: quickStart(START) };
  test("kept per household; anything else starts empty", () => {
    expect(draftFor({ v: 1, householdId: "h1", state }, "h1")).toEqual(state);
    expect(draftFor({ v: 1, householdId: "h1", state }, "h2")).toEqual(EMPTY_PLAN);
    expect(draftFor(null, "h1")).toEqual(EMPTY_PLAN);
    expect(draftFor({ v: 1, householdId: "h1", state: { v: 2 } }, "h1")).toEqual(EMPTY_PLAN);
    expect(draftFor({ v: 1, householdId: "h1", state }, null)).toEqual(EMPTY_PLAN);
  });
});

describe("spending cuts", () => {
  const habitCut = { type: "cut" as const, id: "cut:food/coffee", habit: "food/coffee", label: "Coffee: 3x → 2x a week", monthly: 120_000_00, startMonth: START };

  test("a saved scenario with cuts opens with each cut as its own block and saves the same items back", () => {
    const loan = carBlock(START, "Car A") as Extract<Block, { kind: "loan" }>;
    const items = [loan.item, habitCut, { type: "cut" as const, label: "Fewer dinners out", monthly: 300_000_00, startMonth: START, endMonth: "2027-12" }];
    const blocks = blocksFromSaved(items, null);
    expect(blocks.map((b) => b.kind)).toEqual(["loan", "item", "item"]);
    expect(blocks[1]!.kind === "item" && blocks[1]!.item).toEqual(habitCut);
    const r = openSaved(EMPTY_PLAN, { id: "srv2", name: "Car + cuts", plan: { items }, view: null });
    if (!r.ok) throw new Error(r.reason);
    const s = r.state.scenarios[0]!;
    expect(flatten(s)).toEqual(items);
    expect(compareInput(r.state)!.scenarios[0]!.items).toEqual(items);
    expect(savePayload(r.state, s).plan.items).toEqual(items);
    expect(isDirty(s)).toBe(false);
  });

  test("editing a cut changes only its saving; a new cut starts empty", () => {
    const [b] = blocksFromSaved([habitCut], null);
    const edited = { ...habitCut, monthly: 80_000_00 };
    expect(flatten({ blocks: [{ ...b!, kind: "item", item: edited }] })).toEqual([edited]);
    const fresh = newCut(START);
    expect(fresh.kind === "item" && fresh.item).toEqual({ type: "cut", label: "Spending cut", startMonth: START, monthly: 0 });
    expect(isHabitCut(habitCut)).toBe(true);
    expect(isHabitCut({ type: "cut", label: "x", monthly: 1 })).toBe(false);
    expect(itemWhen(habitCut, (x) => `Rp ${x / 100}`)).toBe(`Rp 120000 less a month from ${START}`);
  });

  test("where to save: the page's baseline, no simulation; suggestions in words", () => {
    expect(savingsInput({ ...EMPTY_PLAN, monthlyIncome: 9 })).toEqual({ monthlyIncome: 9, roles: {}, horizonMonths: 36, effect: false });
    expect(suggestionText({ unit: "week", current: 2.66, target: 2, options: [] })).toBe("2,7x → 2x a week");
    expect(suggestionText({ unit: "month", current: 6, target: 4, options: [] })).toBe("6x → 4x a month");
    expect(suggestionText({ unit: "cap", current: 800_000_00, target: 600_000_00, options: [{ target: 600_000_00, display: "Rp 600.000" }] })).toBe("at most Rp 600.000 a month");
    expect(habitLabel({ kind: "minimarket", name: "minimarket" })).toBe("Minimarket snacks");
    expect(habitLabel({ kind: "category", name: "Coffee" })).toBe("Coffee");
  });
});
