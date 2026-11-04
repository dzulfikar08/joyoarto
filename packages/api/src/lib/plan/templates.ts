// Starting points for common plans. Every number here is a rough estimate to adjust, never a quote or a fact.
import { addMonths } from "./months";
import { defaultResalePct, EV_DEPRECIATION } from "./resale";
import type { ScenarioItemInput } from "./schema";

const jt = (x: number) => Math.round(x * 1_000_000 * 100);
const rb = (x: number) => Math.round(x * 1_000 * 100);

export type Template = {
  id: "car" | "baby" | "carUpgrade";
  name: string;
  description: string;
  /** What each default assumes, in plain words. Show these next to the numbers. */
  estimates: string[];
  items: ScenarioItemInput[];
};

export function carTemplate(opts: { month: string; price?: number; label?: string }): Template {
  return {
    id: "car",
    name: "Car loan (KKB)",
    description: "A car bought on credit: down payment, installments, insurance, fees and running costs.",
    estimates: [
      "Price: enter the on-the-road (OTR) price from the dealer.",
      "Down payment 30% of the price: a common minimum for new cars; check the dealer's offer.",
      "Tenor 48 months: KKB tenors usually run 12 to 60 months.",
      "Interest 5% a year, flat: a placeholder only. Ask the dealer or leasing company for the actual flat rate (promotions can be lower, used cars higher).",
      "All-risk insurance 2.5% of the price for year one, paid upfront; 1.5% a year after. Premiums vary by car, region and insurer.",
      "Admin fee Rp 3.000.000 and provision 1% of the amount financed, paid upfront: confirm with the lender.",
      "PKB (vehicle tax) about 1.5% of the price a year from year two; the first year is usually in the OTR price.",
      "Fuel Rp 1.500.000, parking and tolls Rp 500.000, maintenance Rp 500.000 a month: depends on how much you drive.",
    ],
    items: [
      {
        type: "loan",
        label: opts.label ?? "Car",
        asset: "car",
        month: opts.month,
        price: opts.price ?? 0,
        downPaymentPct: 30,
        fundedFrom: "goal",
        tenorMonths: 48,
        ratePct: 5,
        rateType: "flat",
        payment: "arrears",
        insuranceFirstYearPct: 2.5,
        insuranceFinanced: false,
        insuranceRenewalPct: 1.5,
        adminFee: jt(3),
        provisionPct: 1,
        feesFinanced: false,
        fuelMonthly: jt(1.5),
        parkingTollMonthly: rb(500),
        maintenanceMonthly: rb(500),
        annualTaxPct: 1.5,
        savesMonthly: 0,
      },
    ],
  };
}

export function babyTemplate(opts: { birthMonth: string; caesar?: boolean; caregiver?: boolean }): Template {
  const b = opts.birthMonth;
  const items: ScenarioItemInput[] = [
    { type: "recurring", label: "Pregnancy check-ups", startMonth: addMonths(b, -6), endMonth: addMonths(b, -1), monthly: rb(600) },
    { type: "oneOff", label: "Baby gear (crib, stroller, car seat, clothes)", month: addMonths(b, -1), amount: jt(8), direction: "out", fundedFrom: "spending" },
    {
      type: "oneOff",
      label: opts.caesar ? "Birth (caesarean)" : "Birth (normal delivery)",
      month: b,
      amount: opts.caesar ? jt(30) : jt(12),
      direction: "out",
      fundedFrom: "spending",
    },
    { type: "recurring", label: "Diapers and wipes", startMonth: b, monthly: rb(500), rampTo: rb(800), rampMonths: 12 },
    { type: "recurring", label: "Milk / formula", startMonth: b, monthly: rb(300), rampTo: jt(1.2), rampMonths: 12 },
    { type: "recurring", label: "Check-ups and immunisation", startMonth: b, monthly: rb(500) },
    { type: "recurring", label: "Clothes and supplies", startMonth: b, monthly: rb(300), rampTo: rb(500), rampMonths: 12 },
  ];
  if (opts.caregiver) items.push({ type: "recurring", label: "Caregiver (ART / nanny)", startMonth: b, monthly: jt(3), annualIncreasePct: 10 });
  return {
    id: "baby",
    name: "Baby",
    description: "Pregnancy check-ups, the birth, baby gear and monthly costs that rise over the first year.",
    estimates: [
      "Pregnancy check-ups Rp 600.000 a month for six months before the birth.",
      "Birth: normal delivery around Rp 5–15 jt, caesarean around Rp 15–40 jt at private hospitals; BPJS or office insurance can cover much of it. Default here: Rp 12 jt normal, Rp 30 jt caesarean.",
      "Baby gear Rp 8 jt, bought the month before the birth.",
      "Diapers Rp 500.000 rising to Rp 800.000, milk/formula Rp 300.000 rising to Rp 1.200.000 (less while breastfeeding), check-ups and immunisation Rp 500.000, clothes and supplies Rp 300.000 rising to Rp 500.000 a month over the first year.",
      "Optional caregiver Rp 3 jt a month, up 10% a year.",
      "All of these are rough estimates for a city household; adjust them to your own plans.",
    ],
    items,
  };
}

/** Running costs of a small city EV, rough: home charging, little maintenance, PKB waived for battery EVs. */
const evRunning = { fuelMonthly: rb(400), parkingTollMonthly: rb(500), maintenanceMonthly: rb(200), annualTax: rb(150), insuranceRenewalPct: 1.5 } as const;

/**
 * Buy a small car now, sell it after `sellAfterMonths`, then buy a bigger one in the sale month. Defaults are the
 * example dealer quotes (November 2026): Wuling Aira EV Long Range (OTR Rp 181 jt, 50% DP, 12 × Rp 7.768.000)
 * and Geely EX2 Max (OTR Rp 278,9 jt, DP Rp 106,28 jt, 47 × Rp 4.950.000).
 */
export function carUpgradeTemplate(opts: { month: string; sellAfterMonths?: number; resalePct?: number }): Template {
  const after = opts.sellAfterMonths ?? 18;
  const resalePct = opts.resalePct ?? defaultResalePct(after);
  return {
    id: "carUpgrade",
    name: "Small car now, bigger car later",
    description: `Wuling Aira EV LR now, sold after ${after} months; its sale price settles what is left of its loan and the rest goes to the goal savings. The Geely EX2 Max is bought in the sale month.`,
    estimates: [
      "Aira EV LR: OTR Rp 181 jt, 50% down payment (Rp 90,5 jt), 12 installments of Rp 7.768.000 as quoted (about 3% a year flat). Confirm the quote with the dealer.",
      "Geely EX2 Max: OTR Rp 278,9 jt, down payment Rp 106,28 jt, 47 installments of Rp 4.950.000 as quoted. If that down payment is a total (TDP) that already includes insurance, admin or the first installment, the cash flows here are still right; the loan principal shown is only approximate.",
      `Resale of the Aira after ${after} months: ${resalePct}% of its OTR price (${EV_DEPRECIATION.firstYearPct}% lost in year one, ${EV_DEPRECIATION.laterYearPct}% a year after). Used EV prices in Indonesia fall fast and move with new-car discounts; ask for a trade-in quote.`,
      "A loan still running at the sale is settled from the sale price (outstanding principal, no penalty entered here; ask the lender about pelunasan dipercepat fees). The Aira's 12-month loan is paid off before month 18.",
      "First-year insurance is assumed to be in the dealer's package; renewals 1.5% of the price a year.",
      "Running costs of an EV: charging Rp 400.000, parking and tolls Rp 500.000, maintenance Rp 200.000 a month; PKB is waived for battery EVs in most provinces, about Rp 150.000 a year (SWDKLLJ) from year two.",
    ],
    items: [
      {
        type: "loan",
        id: "aira",
        label: "Wuling Aira EV LR",
        asset: "car",
        month: opts.month,
        price: jt(181),
        downPaymentPct: 50,
        fundedFrom: "goal",
        tenorMonths: 12,
        installment: rb(7_768),
        rateType: "flat",
        payment: "arrears",
        insuranceFirstYear: 0,
        ...evRunning,
        sale: { afterMonths: after, resalePct, settlementPenaltyPct: 0, proceedsTo: "goal" },
      },
      {
        type: "loan",
        id: "ex2",
        label: "Geely EX2 Max",
        asset: "car",
        month: addMonths(opts.month, after),
        price: jt(278.9),
        downPayment: jt(106.28),
        fundedFrom: "goal",
        tenorMonths: 47,
        installment: rb(4_950),
        rateType: "flat",
        payment: "arrears",
        insuranceFirstYear: 0,
        ...evRunning,
      },
    ],
  };
}

export function templates(opts: { month: string; birthMonth?: string; carPrice?: number; sellAfterMonths?: number }): Template[] {
  return [
    carTemplate({ month: opts.month, price: opts.carPrice }),
    babyTemplate({ birthMonth: opts.birthMonth ?? addMonths(opts.month, 6) }),
    carUpgradeTemplate({ month: opts.month, sellAfterMonths: opts.sellAfterMonths }),
  ];
}
