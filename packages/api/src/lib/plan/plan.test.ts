import { describe, expect, test } from "bun:test";

import { existingInstallments, incomeSources, salaryMonths, spendingBaseline, suggestRole } from "./baseline";
import type { CategoryMonth, ExpenseInflow, LargeExpense, TransferMonth } from "./baseline";
import { annuityInstallment, flatInstallment, impliedEffectiveRate, loanTerms, outstandingPrincipal, roundUpRupiah, saleOutcome } from "./loan";
import { defaultResalePct } from "./resale";
import { addMonths, completeMonthsBefore, median, monthsBetween } from "./months";
import { scenarioItem } from "./schema";
import type { ScenarioItem, ScenarioItemInput } from "./schema";
import { DEFAULT_RULES, deposit, draw, incomeFor, recurringAmount, simulate } from "./simulate";
import type { SimBaseline } from "./simulate";
import { babyTemplate, carTemplate, carUpgradeTemplate, templates } from "./templates";

const jt = (x: number) => Math.round(x * 100_000_000);
const item = (x: ScenarioItemInput): ScenarioItem => scenarioItem.parse(x);

describe("months", () => {
  test("arithmetic", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-11", "2027-02")).toBe(3);
    expect(monthsBetween("2027-02", "2026-11")).toBe(-3);
    expect(completeMonthsBefore("2026-11", 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([100, 200, 300, 400])).toBe(300); // 250 rounded to the whole rupiah
    expect(median([])).toBe(0);
  });
});

describe("loan math", () => {
  test("flat rate: interest on the original principal for the whole tenor", () => {
    // Rp 175 jt at 5% flat over 48 months: interest 35 jt, 210 jt / 48 = Rp 4.375.000.
    expect(flatInstallment(jt(175), 5, 48)).toBe(437_500_000);
    expect(flatInstallment(jt(120), 0, 12)).toBe(jt(10));
    expect(flatInstallment(0, 5, 12)).toBe(0);
  });

  test("effective rate: annuity on the declining balance", () => {
    // Rp 100 jt at 10% a year over 12 months: Rp 8.791.588,71 rounded up to Rp 8.791.589.
    expect(annuityInstallment(jt(100), 10, 12)).toBe(879_158_900);
    expect(annuityInstallment(jt(120), 0, 12)).toBe(jt(10));
  });

  test("flat is costlier than the same effective rate, and its effective equivalent is about double", () => {
    expect(flatInstallment(jt(175), 5, 48)).toBeGreaterThan(annuityInstallment(jt(175), 5, 48));
    expect(impliedEffectiveRate(jt(175), flatInstallment(jt(175), 5, 48), 48)).toBeCloseTo(9.2, 1);
    expect(impliedEffectiveRate(jt(100), annuityInstallment(jt(100), 10, 12), 12)).toBeCloseTo(10, 0);
    expect(impliedEffectiveRate(jt(100), jt(100) / 12, 12)).toBe(0);
  });

  test("rounds up to the whole rupiah", () => {
    expect(roundUpRupiah(101)).toBe(200);
    expect(roundUpRupiah(100)).toBe(100);
  });

  const car = (x: Partial<ScenarioItemInput & { type: "loan" }> = {}) =>
    item({ type: "loan", price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5, ...x } as ScenarioItemInput) as Extract<ScenarioItem, { type: "loan" }>;

  test("down payment from a percentage or an amount", () => {
    expect(loanTerms(car()).downPayment).toBe(jt(75));
    expect(loanTerms(car()).principal).toBe(jt(175));
    const fixed = loanTerms(car({ downPayment: jt(50), downPaymentPct: 30 }));
    expect(fixed.downPayment).toBe(jt(50));
    expect(fixed.downPaymentPct).toBe(20);
    expect(loanTerms(car({ downPayment: jt(300) })).principal).toBe(0); // capped at the price: a cash purchase
    expect(loanTerms(car({ downPayment: jt(300) })).installment).toBe(0);
  });

  test("fees and insurance paid upfront or financed", () => {
    const upfront = loanTerms(car({ adminFee: jt(3), provisionPct: 1, insuranceFirstYearPct: 2.5 }));
    expect(upfront.insuranceFirstYear).toBe(jt(6.25));
    expect(upfront.provisionFee).toBe(jt(1.75));
    expect(upfront.principal).toBe(jt(175));
    expect(upfront.upfront).toBe(jt(75 + 3 + 1.75 + 6.25));

    const financed = loanTerms(car({ adminFee: jt(3), provisionPct: 1, insuranceFirstYearPct: 2.5, feesFinanced: true, insuranceFinanced: true }));
    // Provision is on the amount financed, which now includes the premium.
    expect(financed.provisionFee).toBe(roundUpRupiah(jt(181.25) * 0.01));
    expect(financed.principal).toBe(jt(181.25) + jt(3) + financed.provisionFee);
    expect(financed.upfront).toBe(jt(75));
    expect(financed.installment).toBeGreaterThan(upfront.installment);
  });

  test("effective rate paid in advance: smaller installment, schedule clears, implied rate matches", () => {
    // Rp 200 jt at 10% effective over 60 months, first installment with the DP: arrears 4.249.409 / (1 + 10%/12).
    expect(annuityInstallment(jt(200), 10, 60)).toBe(424_940_900);
    expect(annuityInstallment(jt(200), 10, 60, true)).toBe(421_429_000);
    const loan = item({ type: "loan", price: jt(200), downPayment: 0, tenorMonths: 60, rateType: "effective", ratePct: 10, payment: "advance" });
    if (loan.type !== "loan") throw new Error("loan");
    const t = loanTerms(loan);
    expect(t.installment).toBe(421_429_000);
    expect(t.effectiveRatePct).toBe(10);
    // The schedule outstandingPrincipal runs ends at ~0: after 59 installments, the last one (plus a month's interest) clears it.
    const left = outstandingPrincipal(t, 59) * (1 + t.monthlyRate) - t.installment;
    expect(Math.abs(left)).toBeLessThan(jt(0.001));
    // The quoted installment implies the same rate on the same (advance) timing, and the same settlement amount.
    const quoted = loanTerms({ ...loan, installment: t.installment });
    expect(quoted.effectiveRatePct).toBe(10);
    expect(Math.abs(outstandingPrincipal(quoted, 24) - outstandingPrincipal(t, 24))).toBeLessThan(jt(0.01));
    expect(impliedEffectiveRate(jt(200), t.installment, 60, true)).toBe(10);
  });

  test("installment in advance is part of the upfront cash", () => {
    const t = loanTerms(car({ payment: "advance" }));
    expect(t.upfront).toBe(jt(75) + t.installment);
    expect(t.installmentOffsets).toEqual([0, 47]);
    expect(loanTerms(car()).installmentOffsets).toEqual([1, 48]);
  });

  test("total interest and cost of ownership over the tenor", () => {
    const t = loanTerms(car({ fuelMonthly: jt(1.5), insuranceRenewalPct: 1.5, annualTax: jt(4), savesMonthly: jt(0.5) }));
    expect(t.totalInterest).toBe(jt(35));
    expect(t.totalInstallments).toBe(jt(210));
    // DP 75 + installments 210 + (1.5 − 0.5) × 48 + 3 renewals × 3.75 + 3 × PKB 4.
    expect(t.totalCostOfOwnership).toBe(jt(75 + 210 + 48 + 3 * 3.75 + 3 * 4));
  });
});

describe("baseline", () => {
  const window = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

  test("salary paid on the last day for the next month is detected", () => {
    // Paid on the last working day for the next month; July's pay day slipped to Aug 1.
    const pays = ["2026-04-30", "2026-05-29", "2026-06-30", "2026-08-01", "2026-08-31", "2026-09-30", "2026-10-30"].map((date) => ({ date, amount: jt(16) }));
    const s = salaryMonths(window, pays);
    expect(s.calendarGaps).toEqual(["2026-07"]);
    expect(s.calendarDoubles).toEqual(["2026-08"]);
    expect(s.shiftDetected).toBe(true);
    expect(s.months.map((m) => m.amount)).toEqual(Array(6).fill(jt(16)));
    expect(s.median).toBe(jt(16));
    expect(s.note).toContain("2026-08");
  });

  test("salary paid on a regular mid-month day is left alone", () => {
    const pays = window.map((m) => ({ date: `${m}-15`, amount: jt(16) }));
    const s = salaryMonths(window, pays);
    expect(s.shiftDetected).toBe(false);
    expect(s.months.map((m) => m.month)).toEqual(window);
    expect(s.median).toBe(jt(16));
  });

  test("income sources: regular, irregular, and salary shift", () => {
    const txs = [
      ...["2026-04-30", "2026-05-29", "2026-06-30", "2026-08-01", "2026-08-31", "2026-09-30"].map((date) => ({ date, amount: jt(16), slug: "income/salary" })),
      ...window.map((m, i) => ({ date: `${m}-10`, amount: jt(1 + (i % 3)), slug: "income/business" })),
      { date: "2026-06-12", amount: jt(5), slug: "income/gift" },
      { date: "2026-07-12", amount: jt(2), slug: "income/interest" },
      { date: "2026-07-13", amount: jt(1), slug: null },
    ];
    const names = new Map([["income/salary", "Salary"]]);
    const { sources, salary } = incomeSources(window, txs, names);
    const by = new Map(sources.map((s) => [s.slug, s]));
    expect(salary.shiftDetected).toBe(true);
    expect(by.get("income/salary")!.recurring).toBe(jt(16));
    expect(by.get("income/salary")!.name).toBe("Salary");
    // Calendar months: one shows 32 jt and one 0, but the median is still 16.
    expect(by.get("income/salary")!.median).toBe(jt(16));
    expect(by.get("income/business")!.irregular).toBe(false);
    expect(by.get("income/business")!.recurring).toBe(jt(2)); // min(avg 2, median 2)
    expect(by.get("income/gift")!.irregular).toBe(true);
    expect(by.get("income/gift")!.recurring).toBe(0);
    expect(by.get("income/interest")!.reason).toBe("Only in 1 of 6 months.");
    expect(by.get(null)!.irregular).toBe(true);
  });

  test("spending: one-off outliers above max(Rp 2 jt, 25% of the month) are excluded", () => {
    const rows = window.flatMap((m) => [
      { month: m, slug: "food", total: jt(4) },
      { month: m, slug: "bills", total: jt(3) },
    ]);
    rows.push({ month: "2026-08", slug: "shopping", total: jt(12) });
    const large = [
      { id: "tv", date: "2026-08-20", amount: jt(12), description: "TV", slug: "shopping" },
      // 4 jt in a 19 jt month: above Rp 2 jt but under 25% of the month: stays.
      { id: "fridge", date: "2026-08-03", amount: jt(4), description: "Fridge", slug: "shopping" },
      // 1.9 jt in a 7 jt month: over 25% but under Rp 2 jt: stays.
      { id: "school", date: "2026-07-03", amount: jt(1.9), description: "School", slug: "bills" },
    ];
    const s = spendingBaseline(window, rows, large, new Map([["food", "Food & drink"]]));
    expect(s.excluded.map((e) => e.id)).toEqual(["tv"]);
    expect(s.excluded[0]!.threshold).toBe(jt(19 * 0.25));
    expect(s.byMonth.find((m) => m.month === "2026-08")).toEqual({ month: "2026-08", total: jt(19), excluded: jt(12), core: jt(7), outliers: jt(12), refunds: 0 });
    expect(s.average).toBe(jt(9));
    expect(s.coreAverage).toBe(jt(7));
    expect(s.monthly).toBe(jt(7));
    const shopping = s.categories.find((c) => c.slug === "shopping")!;
    expect(shopping.average).toBe(jt(2));
    expect(shopping.coreAverage).toBe(0);
    expect(s.byMonth.find((m) => m.month === "2026-07")!.excluded).toBe(0);
    expect(s.categories[0]!.name).toBe("Food & drink");
  });

  // Made-up shape: ~Rp 6,5 jt of normal spending a month, a Rp 15 jt renovation with a partner's Rp 15 jt share
  // recorded back into `home`, and a cancelled Rp 5,4 jt Shopee order refunded (Rp 5,5 jt) early the next month.
  const normal: Record<string, number> = { "2026-05": 6.2, "2026-06": 6.6, "2026-07": 6.4, "2026-08": 6.4, "2026-09": 6.8, "2026-10": 6.5 };
  function refundCase() {
    const rows: CategoryMonth[] = window.flatMap((m) => [
      { month: m, slug: "food", total: jt(normal[m]! - 3), out: jt(normal[m]! - 3) },
      { month: m, slug: "bills", total: jt(3), out: jt(3) },
    ]);
    // home: −15 jt renovation and +15 jt from the partner in July nets to 0.
    rows.push({ month: "2026-07", slug: "home", total: 0, out: jt(15) });
    rows.push({ month: "2026-09", slug: "shopping", total: jt(5.4), out: jt(5.4) });
    rows.push({ month: "2026-10", slug: "shopping", total: -jt(5.5), out: 0 });
    const large: LargeExpense[] = [
      { id: "reno", date: "2026-07-10", amount: jt(15), description: "Renovasi dapur", slug: "home" },
      { id: "shopee", date: "2026-09-27", amount: jt(5.4), description: "Shopee", slug: "shopping" },
    ];
    const inflows: ExpenseInflow[] = [
      { id: "spouse", date: "2026-07-12", amount: jt(15), description: "Transfer patungan renovasi", slug: "home" },
      { id: "refund", date: "2026-10-03", amount: jt(5.5), description: "Shopee refund", slug: "shopping" },
      // An ordinary small refund stays in spending.
      { id: "small", date: "2026-08-05", amount: jt(0.2), description: "Refund ongkir", slug: "shopping" },
    ];
    rows.push({ month: "2026-08", slug: "shopping", total: -jt(0.2), out: 0 });
    return { rows, large, inflows };
  }

  test("spending: refunds of one-offs are excluded with them (renovation share, cancelled order)", () => {
    const { rows, large, inflows } = refundCase();
    const s = spendingBaseline(window, rows, large, new Map(), undefined, inflows);
    expect(s.excluded.map((e) => [e.id, e.kind, e.pairedWith])).toEqual([
      ["reno", "expense", null],
      ["spouse", "refund", "reno"],
      ["shopee", "expense", null],
      ["refund", "refund", "shopee"],
    ]);
    expect(s.excluded[1]!.amount).toBe(-jt(15));
    const by = new Map(s.byMonth.map((x) => [x.month, x]));
    expect(by.get("2026-07")).toEqual({ month: "2026-07", total: jt(6.4), excluded: 0, core: jt(6.4), outliers: jt(15), refunds: jt(15) });
    expect(by.get("2026-09")!.core).toBe(jt(6.8));
    expect(by.get("2026-10")!.core).toBe(jt(6.5));
    expect(by.get("2026-08")!.core).toBe(jt(6.2)); // 6,4 − the small refund
    expect(s.byMonth.every((x) => x.core >= 0)).toBe(true);
    expect(s.coreMedian).toBe(jt(6.45));
    expect(s.coreAverage).toBe(jt((6.2 + 6.6 + 6.4 + 6.2 + 6.8 + 6.5) / 6));
    expect(s.monthly).toBe(Math.max(s.coreAverage, s.coreMedian));
    expect(s.categories.find((c) => c.slug === "home")?.coreAverage ?? 0).toBe(0);
    expect(s.categories.find((c) => c.slug === "shopping")?.coreAverage ?? 0).toBe(0);
  });

  test("spending: refund pairing needs same category, ±31 days and at least half the one-off", () => {
    const rows: CategoryMonth[] = window.map((m) => ({ month: m, slug: "food", total: jt(8), out: jt(8) }));
    rows.push({ month: "2026-06", slug: "home", total: jt(10), out: jt(10) });
    const large: LargeExpense[] = [{ id: "sofa", date: "2026-06-01", amount: jt(10), description: "Sofa", slug: "home" }];
    const inflows: ExpenseInflow[] = [
      { id: "other-cat", date: "2026-06-02", amount: jt(10), description: "x", slug: "shopping" },
      { id: "too-late", date: "2026-07-05", amount: jt(10), description: "x", slug: "home" },
      { id: "too-small", date: "2026-06-03", amount: jt(4), description: "x", slug: "home" },
      { id: "ok-far", date: "2026-06-30", amount: jt(6), description: "x", slug: "home" },
      { id: "ok-close", date: "2026-06-20", amount: jt(9), description: "x", slug: "home" },
    ];
    const s = spendingBaseline(window, rows, large, new Map(), undefined, inflows);
    expect(s.excluded.find((e) => e.pairedWith === "sofa")!.id).toBe("ok-close");
    // Inflows above the month's one-off threshold with nothing to pair are one-offs too; the small one stays.
    expect(s.excluded.filter((e) => e.kind === "refund" && e.pairedWith === null).map((e) => e.id).sort()).toEqual(["ok-far", "other-cat", "too-late"]);
  });

  test("spending: core never goes below zero", () => {
    const rows: CategoryMonth[] = window.map((m) => ({ month: m, slug: "food", total: jt(1), out: jt(1) }));
    rows.push({ month: "2026-05", slug: "shopping", total: -jt(1.5), out: 0 });
    const s = spendingBaseline(window, rows, [], new Map(), undefined, [{ id: "r", date: "2026-05-02", amount: jt(1.5), description: "refund", slug: "shopping" }]);
    // 1,5 jt is under the Rp 2 jt one-off floor, so it stays and would make May negative.
    expect(s.byMonth[0]!.core).toBe(0);
  });

  test("existing installments: own debt only, recurring, net of repayments", () => {
    const tm = (slug: string, name: string, month: string, out: number, inn = 0): TransferMonth => ({ slug, name, month, out, in: inn });
    const rows: TransferMonth[] = [
      // Money lent to a brother and paid back: not an installment.
      tm("transfer/loan", "Loans to family", "2026-07", jt(3)),
      tm("transfer/loan", "Loans to family", "2026-09", 0, jt(3)),
      // A generic loan category paid out and back: nets to zero.
      tm("transfer/pinjaman", "Pinjaman", "2026-06", jt(2)),
      tm("transfer/pinjaman", "Pinjaman", "2026-08", 0, jt(2)),
      ...window.map((m) => tm("transfer/cicilan-motor", "Cicilan motor", m, jt(1.2))),
      // KPR seen in only 2 months.
      tm("transfer/kpr", "KPR BTN", "2026-09", jt(4)),
      tm("transfer/kpr", "KPR BTN", "2026-10", jt(4)),
      // Card bills settle spending already counted.
      ...window.map((m) => tm("transfer/credit-card", "Credit card payment", m, jt(5))),
      // Paylater: 4 of 6 months, one month partly refunded.
      tm("transfer/paylater", "SPayLater", "2026-07", jt(0.5)),
      tm("transfer/paylater", "SPayLater", "2026-08", jt(0.5)),
      tm("transfer/paylater", "SPayLater", "2026-09", jt(0.5), jt(0.3)),
      tm("transfer/paylater", "SPayLater", "2026-10", jt(0.5)),
      // A leasing that ended in July.
      ...["2026-05", "2026-06", "2026-07"].map((m) => tm("transfer/leasing", "Leasing mobil", m, jt(3))),
      // Not debt at all.
      ...window.map((m) => tm("transfer/savings", "Savings", m, jt(2))),
    ];
    const r = existingInstallments(window, rows);
    expect(r.categories.map((c) => [c.slug, c.monthly])).toEqual([
      ["transfer/cicilan-motor", jt(1.2)],
      ["transfer/paylater", jt(0.425)], // median(0.5, 0.5, 0.2, 0.5) = 0.5, capped by net 1.7 / 4
    ]);
    expect(r.categories[0]!.months).toEqual(window);
    expect(r.categories[1]!.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(r.monthly).toBe(jt(1.625));
    const skipped = new Map(r.skipped.map((x) => [x.slug, x.reason]));
    expect(skipped.get("transfer/loan")).toContain("lent");
    expect(skipped.get("transfer/pinjaman")).toContain("Paid back");
    expect(skipped.get("transfer/kpr")).toBe("Paid in only 2 of 6 months.");
    expect(skipped.get("transfer/credit-card")).toContain("Credit-card");
    expect(skipped.get("transfer/leasing")).toContain("finished");
    expect(skipped.has("transfer/savings")).toBe(false);
  });

  test("existing installments: a loan to family that was repaid counts nothing", () => {
    const r = existingInstallments(window, [
      { slug: "transfer/loan", name: "Loans to family", month: "2026-08", out: jt(2.5), in: 0 },
      { slug: "transfer/loan", name: "Loans to family", month: "2026-09", out: 0, in: jt(2.5) },
    ]);
    expect(r.monthly).toBe(0);
    expect(r.categories).toEqual([]);
  });

  test("account roles from names and types", () => {
    expect(suggestRole({ name: "Jago · Dana Darurat", institution: "jago", type: "bank" }).role).toBe("emergency");
    expect(suggestRole({ name: "Tabungan Mobil", institution: "bca", type: "bank" }).role).toBe("goal");
    expect(suggestRole({ name: "Jago · Liburan Bali", institution: "jago", type: "bank" }).role).toBe("goal");
    expect(suggestRole({ name: "Jago · Main Pocket", institution: "jago", type: "bank" }).role).toBe("spending");
    expect(suggestRole({ name: "Jago · Belanja", institution: "jago", type: "bank" }).role).toBe("spending");
    expect(suggestRole({ name: "BCA", institution: "bca", type: "bank" }).role).toBe("spending");
    expect(suggestRole({ name: "GoPay wallet", institution: "gopay", type: "ewallet" }).role).toBe("spending");
    expect(suggestRole({ name: "BCA Visa", institution: "bca", type: "credit_card" }).role).toBe("exclude");
    expect(suggestRole({ name: "Bibit", institution: "other", type: "investment" }).role).toBe("exclude");
  });
});

describe("simulate", () => {
  const base: SimBaseline = {
    currency: "IDR",
    monthlyIncome: jt(18),
    monthlySpending: jt(8),
    existingInstallments: 0,
    balances: { emergency: jt(60), goal: jt(46), spending: jt(10) },
    accountRoles: { "acc-car": "goal", "acc-ef": "emergency" },
  };
  const opts = { startMonth: "2026-12", horizonMonths: 36, rules: DEFAULT_RULES };

  test("bucket draws: funded account first, then spending, goal, emergency", () => {
    const b = { emergency: jt(60), goal: jt(46), spending: jt(10) };
    expect(draw(b, "goal", jt(90))).toBe(jt(34));
    expect(b).toEqual({ emergency: jt(26), goal: 0, spending: 0 });
    expect(draw(b, "goal", jt(30))).toBe(jt(26));
    expect(b.spending).toBe(-jt(4));
    deposit(b, jt(10), { emergency: jt(60), goal: jt(46), spending: 0 });
    expect(b).toEqual({ emergency: jt(6), goal: 0, spending: 0 });
  });

  test("recurring ramps and yearly increases; income changes", () => {
    const r = item({ type: "recurring", label: "Milk", monthly: jt(0.3), rampTo: jt(1.2), rampMonths: 12 }) as Extract<ScenarioItem, { type: "recurring" }>;
    expect(recurringAmount(r, 0)).toBe(jt(0.3));
    expect(recurringAmount(r, 6)).toBe(jt(0.75));
    expect(recurringAmount(r, 24)).toBe(jt(1.2));
    const c = item({ type: "recurring", label: "Nanny", monthly: jt(3), annualIncreasePct: 10 }) as Extract<ScenarioItem, { type: "recurring" }>;
    expect(recurringAmount(c, 11)).toBe(jt(3));
    expect(recurringAmount(c, 12)).toBe(jt(3.3));
    const changes = [
      item({ type: "incomeChange", label: "Leave", startMonth: "2027-03", endMonth: "2027-05", mode: "replace", amount: jt(10) }),
      item({ type: "incomeChange", label: "Raise", startMonth: "2027-01", amount: jt(1) }),
    ] as Extract<ScenarioItem, { type: "incomeChange" }>[];
    expect(incomeFor(jt(18), changes, "2026-12", "2026-12")).toBe(jt(18));
    expect(incomeFor(jt(18), changes, "2027-02", "2026-12")).toBe(jt(19));
    expect(incomeFor(jt(18), changes, "2027-04", "2026-12")).toBe(jt(11));
    expect(incomeFor(jt(18), changes, "2027-06", "2026-12")).toBe(jt(19));
  });

  test("no change: comfortable, savings grow by free cash", () => {
    const r = simulate(base, [], opts);
    expect(r.projection).toHaveLength(36);
    expect(r.projection[0]!.freeCash).toBe(jt(10));
    expect(r.projection[35]!.total).toBe(jt(116 + 36 * 10));
    expect(r.verdict).toBe("comfortable");
    expect(r.rules.find((x) => x.id === "emergency")!.value).toBe(7.5);
    expect(r.summary.goalRebuiltInMonths).toBe(0);
  });

  test("car of Rp 250 jt, 30% DP, 48 months: installments start the month after purchase", () => {
    const car = item({ type: "loan", label: "Car A", month: "2026-12", price: jt(250), downPaymentPct: 30, fundedFrom: "acc-car", tenorMonths: 48, ratePct: 5, fuelMonthly: jt(1.5) });
    const r = simulate(base, [car], opts);
    const [m0, m1] = r.projection;
    expect(m0!.upfront).toBe(jt(75));
    expect(m0!.installments).toBe(0);
    expect(m1!.installments).toBe(437_500_000);
    expect(m0!.vehicleCosts).toBe(jt(1.5));
    // DP 75 jt: 46 from the goal pocket, 10 from spending, 19 from the emergency fund.
    expect(m0!.balances.goal).toBe(0);
    expect(r.rules.find((x) => x.id === "emergency")!.detail).toContain("Rp 19.000.000 of the upfront costs");
    // 4.375 jt / 18 jt = 24.3%: above the 20% car rule, within 30% overall.
    expect(r.summary.carRatioPct).toBe(24.3);
    expect(r.rules.find((x) => x.id === "car")!.status).toBe("warn");
    expect(r.rules.find((x) => x.id === "debt")!.status).toBe("ok");
    expect(r.verdict).not.toBe("comfortable");
    expect(r.summary.goalRebuiltInMonths).not.toBe(0);
    expect(r.loans[0]!.terms.installment).toBe(437_500_000);
  });

  test("running out of money is risky", () => {
    const r = simulate({ ...base, monthlyIncome: jt(8), balances: { emergency: jt(5), goal: 0, spending: 0 } }, [
      item({ type: "recurring", label: "Rent", monthly: jt(1) }),
    ], opts);
    expect(r.projection[4]!.total).toBe(0);
    expect(r.projection[5]!.total).toBe(-jt(1));
    expect(r.verdict).toBe("risky");
    expect(r.rules.find((x) => x.id === "balance")!.detail).toContain("runs out in 2027-05");
    expect(r.rules.find((x) => x.id === "cashflow")!.status).toBe("fail");
  });

  test("one-off inflow and existing installments", () => {
    const r = simulate({ ...base, existingInstallments: jt(2) }, [item({ type: "oneOff", label: "Sell old car", amount: jt(50), direction: "in", fundedFrom: "goal" })], opts);
    expect(r.projection[0]!.inflows).toBe(jt(50));
    expect(r.projection[0]!.balances.goal).toBe(jt(96));
    expect(r.projection[0]!.installments).toBe(jt(2));
    expect(r.summary.debtRatioPct).toBe(11.1);
  });

  test("advance installment is not counted twice", () => {
    const car = item({ type: "loan", price: jt(120), downPaymentPct: 0, tenorMonths: 12, ratePct: 0, payment: "advance", fundedFrom: "spending" });
    const r = simulate(base, [car], opts);
    expect(r.projection[0]!.upfront).toBe(jt(10));
    expect(r.projection[0]!.installments).toBe(0);
    expect(r.projection.reduce((s, p) => s + p.installments, 0)).toBe(jt(110));
  });
});

describe("templates", () => {
  test("every template item is a valid scenario item", () => {
    for (const t of templates({ month: "2026-12", carPrice: jt(250) })) {
      expect(t.estimates.length).toBeGreaterThan(0);
      for (const i of t.items) expect(() => scenarioItem.parse(i)).not.toThrow();
    }
    expect(carTemplate({ month: "2026-12" }).items[0]).toMatchObject({ price: 0, downPaymentPct: 30, rateType: "flat" });
    const baby = babyTemplate({ birthMonth: "2027-06", caesar: true, caregiver: true });
    expect(baby.items.find((i) => i.type === "oneOff" && i.label.includes("caesarean"))).toBeTruthy();
    expect(baby.items.some((i) => i.label?.startsWith("Caregiver"))).toBe(true);
  });

  test("car + baby scenario from templates projects sensibly", () => {
    const items = [
      ...carTemplate({ month: "2026-12", price: jt(250) }).items,
      ...babyTemplate({ birthMonth: "2027-06" }).items,
    ].map((i) => scenarioItem.parse(i));
    const r = simulate(
      { currency: "IDR", monthlyIncome: jt(18), monthlySpending: jt(8), existingInstallments: 0, balances: { emergency: jt(60), goal: jt(46), spending: jt(10) }, accountRoles: {} },
      items,
      { startMonth: "2026-12", horizonMonths: 36, rules: DEFAULT_RULES },
    );
    expect(r.loans[0]!.terms.upfront).toBe(jt(75 + 6.25 + 3 + 1.75));
    expect(["tight", "risky"]).toContain(r.verdict);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.assumptions.length).toBeGreaterThan(3);
  });
});

describe("quoted installments, early settlement and resale", () => {
  const loan = (x: Record<string, unknown>) => item({ type: "loan", ...x } as ScenarioItemInput) as Extract<ScenarioItem, { type: "loan" }>;

  test("a loan needs a rate or a quoted installment", () => {
    expect(scenarioItem.safeParse({ type: "loan", price: jt(100), tenorMonths: 12 }).success).toBe(false);
    expect(scenarioItem.safeParse({ type: "loan", price: jt(100), tenorMonths: 12, installment: jt(9) }).success).toBe(true);
  });

  test("a quoted installment is used as is and its rate is reported", () => {
    const t = loanTerms(loan({ price: jt(181), downPaymentPct: 50, tenorMonths: 12, installment: 776_800_000 }));
    expect(t.principal).toBe(jt(90.5));
    expect(t.installment).toBe(776_800_000);
    expect(t.totalInterest).toBe(jt(93.216 - 90.5));
    expect(t.effectiveRatePct).toBeCloseTo(5.5, 1); // about 3% flat
  });

  test("outstanding principal follows the declining balance", () => {
    const zero = loanTerms(loan({ price: jt(120), downPayment: 0, tenorMonths: 12, ratePct: 0 }));
    expect(outstandingPrincipal(zero, 0)).toBe(jt(120));
    expect(outstandingPrincipal(zero, 5)).toBe(jt(70));
    expect(outstandingPrincipal(zero, 12)).toBe(0);
    expect(outstandingPrincipal(zero, 20)).toBe(0);

    const eff = loanTerms(loan({ price: jt(100), downPayment: 0, tenorMonths: 12, ratePct: 12, rateType: "effective" }));
    // Balance after 6 payments at 1% a month = PV of the 6 left.
    const pv = Math.round((eff.installment * (1 - 1.01 ** -6)) / 0.01);
    expect(Math.abs(outstandingPrincipal(eff, 6) - pv)).toBeLessThan(200);

    // Flat loan: more principal is left than the straight-line share, because early installments are mostly interest.
    const flat = loanTerms(loan({ price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5 }));
    const left = outstandingPrincipal(flat, 17);
    expect(left).toBeGreaterThan(jt(175) - (17 * jt(175)) / 48);
    expect(left).toBeLessThan(jt(175));
  });

  test("default EV resale curve", () => {
    expect(defaultResalePct(0)).toBe(100);
    expect(defaultResalePct(12)).toBe(65);
    expect(defaultResalePct(18)).toBe(60);
    expect(defaultResalePct(36)).toBe(45);
    expect(defaultResalePct(200)).toBe(15);
  });

  test("sale outcome: proceeds settle the loan plus penalty", () => {
    const car = loan({ price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5, sale: { afterMonths: 18, settlementPenaltyPct: 2 } });
    const t = loanTerms(car);
    const s = saleOutcome(car, t)!;
    expect(s.installmentsPaid).toBe(17); // arrears: installments in months 1..17; month 18 is settled instead
    expect(s.resaleEstimated).toBe(true);
    expect(s.resalePct).toBe(60);
    expect(s.resale).toBe(jt(150));
    expect(s.outstanding).toBe(outstandingPrincipal(t, 17));
    expect(s.penalty).toBe(roundUpRupiah(s.outstanding * 0.02));
    expect(s.net).toBe(jt(150) - s.outstanding - s.penalty);

    const fixed = saleOutcome(loan({ price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5, sale: { afterMonths: 18, resaleAmount: jt(140) } }), t)!;
    expect(fixed.resale).toBe(jt(140));
    expect(fixed.resalePct).toBe(56);
    expect(fixed.penalty).toBe(0);
    // Advance: the first installment counts as paid.
    const adv = loan({ price: jt(120), downPayment: 0, tenorMonths: 12, ratePct: 0, payment: "advance", sale: { afterMonths: 3, resalePct: 90 } });
    expect(saleOutcome(adv, loanTerms(adv))!.installmentsPaid).toBe(3);
    expect(saleOutcome(adv, loanTerms(adv))!.outstanding).toBe(jt(90));
  });

  const base: SimBaseline = {
    currency: "IDR",
    monthlyIncome: jt(25),
    monthlySpending: jt(10),
    existingInstallments: 0,
    balances: { emergency: jt(80), goal: jt(120), spending: jt(10) },
    accountRoles: {},
  };
  const opts = { startMonth: "2026-12", horizonMonths: 48, rules: DEFAULT_RULES };

  test("selling mid-loan: costs stop, the loan is settled, the rest goes to the goal savings", () => {
    const car = loan({ price: jt(250), downPaymentPct: 30, tenorMonths: 48, ratePct: 5, fuelMonthly: jt(1), insuranceRenewalPct: 1.5, sale: { afterMonths: 18, resalePct: 60 } });
    const r = simulate(base, [car], opts);
    const sale = r.loans[0]!.sale!;
    expect(sale.month).toBe("2028-06");
    const [m17, m18, m19] = [r.projection[17]!, r.projection[18]!, r.projection[19]!];
    expect(m17.installments).toBe(437_500_000);
    expect(m17.vehicleCosts).toBe(jt(1));
    expect(m18.installments).toBe(0);
    expect(m18.vehicleCosts).toBe(0);
    expect(m18.inflows).toBe(sale.net);
    expect(sale.net).toBe(jt(150) - sale.outstanding);
    expect(sale.outstanding).toBeGreaterThan(jt(100));
    expect(m19.installments).toBe(0);
    // Net proceeds land in the goal pocket (before that month's surplus is shared out).
    expect(m18.balances.goal).toBeGreaterThanOrEqual(m17.balances.goal + sale.net);
    expect(r.projection.filter((p) => p.installments > 0)).toHaveLength(17);
    expect(r.assumptions.some((a) => a.includes("settles the loan"))).toBe(true);
    // Cost while owned: DP, 17 installments, 18 months of fuel, one renewal, minus what the sale left over.
    expect(sale.costWhileOwned).toBe(jt(75) + 17 * 437_500_000 + 18 * jt(1) + jt(3.75) - sale.net);
  });

  test("selling for less than the loan: the shortfall is paid from the proceeds' account", () => {
    const car = loan({ price: jt(250), downPayment: 0, tenorMonths: 60, ratePct: 5, sale: { afterMonths: 6, resaleAmount: jt(150), proceedsTo: "spending" } });
    const r = simulate(base, [car], opts);
    const sale = r.loans[0]!.sale!;
    expect(sale.net).toBeLessThan(0);
    expect(r.projection[6]!.upfront).toBe(-sale.net);
    expect(r.projection[6]!.inflows).toBe(0);
  });

  test("upgrade template: Aira EV now, sold after 18 months, Geely EX2 Max in the sale month", () => {
    const t = carUpgradeTemplate({ month: "2026-12" });
    const items = t.items.map((i) => scenarioItem.parse(i));
    expect(items).toHaveLength(2);
    const r = simulate(base, items, opts);
    const [aira, ex2] = r.loans;
    expect(aira!.terms.downPayment).toBe(jt(90.5));
    expect(aira!.terms.installment).toBe(776_800_000);
    expect(aira!.sale).toMatchObject({ month: "2028-06", installmentsPaid: 12, outstanding: 0, resalePct: 60, resale: jt(108.6), net: jt(108.6) });
    expect(ex2!.month).toBe("2028-06");
    expect(ex2!.terms.downPayment).toBe(jt(106.28));
    expect(ex2!.terms.installment).toBe(495_000_000);
    expect(ex2!.terms.principal).toBe(jt(278.9 - 106.28));
    // Aira installments in months 1–12, nothing in 13–18, the EX2 Max from month 19 for 47 months.
    expect(r.projection[1]!.carInstallments).toBe(776_800_000);
    expect(r.projection[12]!.carInstallments).toBe(776_800_000);
    expect(r.projection[13]!.carInstallments).toBe(0);
    expect(r.projection[18]!.carInstallments).toBe(0);
    expect(r.projection[19]!.carInstallments).toBe(495_000_000);
    // In the sale month the trade-in brings Rp 108,6 jt and the new DP takes Rp 106,28 jt.
    expect(r.projection[18]!.inflows).toBe(jt(108.6));
    expect(r.projection[18]!.upfront).toBe(jt(106.28));
    // The two loans never overlap, so the peak car installment is the Aira's, not the sum.
    expect(r.summary.carInstallment).toBe(776_800_000);
    expect(r.summary.installment).toBe(776_800_000);
    expect(t.estimates.some((e) => e.includes("60%"))).toBe(true);
    expect(carUpgradeTemplate({ month: "2026-12", sellAfterMonths: 12 }).items[1]).toMatchObject({ month: "2027-12" });
    expect(templates({ month: "2026-12" }).map((x) => x.id)).toEqual(["car", "baby", "carUpgrade"]);
  });
});
