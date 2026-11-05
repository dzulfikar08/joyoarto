// Loan arithmetic in integer minor units. Installments are rounded up to the whole rupiah (100 minor units), as
// lenders do; totals are sums of the rounded installments.
import { defaultResalePct } from "./resale";
import type { LoanItem } from "./schema";

const RUPIAH = 100;

export function roundUpRupiah(minor: number): number {
  return Math.ceil(minor / RUPIAH - 1e-9) * RUPIAH + 0; // + 0: never -0
}

/** Flat rate: interest = principal × rate × years, spread evenly with the principal over the tenor. */
export function flatInstallment(principal: number, ratePct: number, months: number): number {
  if (principal <= 0) return 0;
  const interest = principal * (ratePct / 100) * (months / 12);
  return roundUpRupiah((principal + interest) / months);
}

/** Unrounded annuity payment at monthly rate i; paid in advance, the first one is due at once (no interest on it). */
function annuity(principal: number, i: number, months: number, advance: boolean): number {
  if (i === 0) return principal / months;
  const arrears = (principal * i) / (1 - (1 + i) ** -months);
  return advance ? arrears / (1 + i) : arrears;
}

/**
 * Effective (annuity) rate: the payment that clears the declining balance at ratePct/12 per month. In advance (the
 * first installment paid with the down payment) each payment comes a month earlier, so it is smaller by (1 + i).
 */
export function annuityInstallment(principal: number, ratePct: number, months: number, advance = false): number {
  if (principal <= 0) return 0;
  return roundUpRupiah(annuity(principal, ratePct / 100 / 12, months, advance));
}

/** The effective yearly rate (annuity, %) that a given installment implies; one decimal. Bisection. */
export function impliedEffectiveRate(principal: number, installment: number, months: number, advance = false): number {
  return Math.round(impliedRateRaw(principal, installment, months, advance) * 10) / 10;
}

function impliedRateRaw(principal: number, installment: number, months: number, advance = false): number {
  if (principal <= 0 || installment * months <= principal) return 0;
  // One installment paid at once carries no interest, whatever the rate.
  if (advance && months <= 1) return 0;
  let lo = 0;
  let hi = 200;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    const pmt = annuity(principal, mid / 100 / 12, months, advance);
    if (pmt > installment) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export type LoanTerms = {
  price: number;
  downPayment: number;
  downPaymentPct: number;
  insuranceFirstYear: number;
  insuranceRenewalYearly: number;
  adminFee: number;
  provisionFee: number;
  /** Amount the lender pays out: price − DP, plus whatever fees and premium are financed. */
  principal: number;
  installment: number;
  tenorMonths: number;
  totalInstallments: number;
  totalInterest: number;
  /** Effective yearly rate equivalent of the installment (equals ratePct for effective loans). */
  effectiveRatePct: number;
  /** Unrounded monthly rate of the declining-balance schedule, for early settlement. */
  monthlyRate: number;
  /** The first installment is paid with the down payment. */
  advance: boolean;
  /** Cash out in the purchase month: DP, unfinanced fees and premium, and the first installment when paid in advance. */
  upfront: number;
  runningMonthly: number;
  annualTax: number;
  /** Months (from the purchase month, 0-based) in which an installment is due. */
  installmentOffsets: [number, number];
  /** Everything paid over the tenor: upfront, installments, running costs, insurance renewals and tax, minus what the car saves. */
  totalCostOfOwnership: number;
};

export function loanTerms(item: LoanItem): LoanTerms {
  const price = item.price;
  const downPayment =
    item.downPayment !== undefined ? Math.min(item.downPayment, price) : roundUpRupiah((price * (item.downPaymentPct ?? 0)) / 100);
  const insuranceFirstYear = item.insuranceFirstYear ?? roundUpRupiah((price * (item.insuranceFirstYearPct ?? 0)) / 100);
  const insuranceRenewalYearly = roundUpRupiah((price * item.insuranceRenewalPct) / 100);
  const annualTax = item.annualTax ?? roundUpRupiah((price * (item.annualTaxPct ?? 0)) / 100);

  const base = price - downPayment + (item.insuranceFinanced ? insuranceFirstYear : 0);
  const provisionFee = roundUpRupiah((base * item.provisionPct) / 100);
  const fees = item.adminFee + provisionFee;
  const principal = base + (item.feesFinanced ? fees : 0);

  const n = item.tenorMonths;
  const rate = item.ratePct ?? 0;
  const quoted = item.installment !== undefined;
  const inAdvance = item.payment === "advance";
  const installment =
    principal <= 0
      ? 0
      : quoted
        ? item.installment!
        : item.rateType === "flat"
          ? flatInstallment(principal, rate, n)
          : annuityInstallment(principal, rate, n, inAdvance);
  const totalInstallments = installment * n;
  const totalInterest = Math.max(0, totalInstallments - principal);
  const advance = inAdvance && installment > 0;
  const upfront =
    downPayment + (item.feesFinanced ? 0 : fees) + (item.insuranceFinanced ? 0 : insuranceFirstYear) + (advance ? installment : 0);
  const runningMonthly = item.fuelMonthly + item.parkingTollMonthly + item.maintenanceMonthly;

  const years = Math.ceil(n / 12);
  const renewals = Math.max(0, years - 1) * insuranceRenewalYearly;
  const taxes = Math.max(0, years - 1) * annualTax;
  const totalCostOfOwnership =
    upfront + totalInstallments - (advance ? installment : 0) + (runningMonthly - item.savesMonthly) * n + renewals + taxes;

  return {
    price,
    downPayment,
    downPaymentPct: price ? Math.round((downPayment / price) * 1000) / 10 : 0,
    insuranceFirstYear,
    insuranceRenewalYearly,
    adminFee: item.adminFee,
    provisionFee,
    principal,
    installment,
    tenorMonths: n,
    totalInstallments,
    totalInterest,
    // Solved on the same timing (arrears or advance) that outstandingPrincipal runs the schedule on.
    effectiveRatePct: item.rateType === "effective" && !quoted ? rate : impliedEffectiveRate(principal, installment, n, advance),
    monthlyRate: item.rateType === "effective" && !quoted ? rate / 1200 : impliedRateRaw(principal, installment, n, advance) / 1200,
    advance,
    upfront,
    runningMonthly,
    annualTax,
    installmentOffsets: advance ? [0, n - 1] : [1, n],
    totalCostOfOwnership,
  };
}

/**
 * Principal still owed after `paid` installments, on the declining-balance schedule at the loan's effective rate
 * (for flat loans: the effective rate the installment implies), which is how lenders work out early settlement.
 */
export function outstandingPrincipal(t: LoanTerms, paid: number): number {
  if (t.principal <= 0 || paid >= t.tenorMonths) return 0;
  let b = t.principal;
  for (let j = 0; j < paid; j++) {
    if (j > 0 || !t.advance) b *= 1 + t.monthlyRate;
    b -= t.installment;
  }
  return Math.max(0, roundUpRupiah(b));
}

export type SaleOutcome = {
  /** Months after purchase; the sale month. */
  offset: number;
  resale: number;
  resalePct: number;
  /** True when the resale value is the default EV estimate rather than entered. */
  resaleEstimated: boolean;
  installmentsPaid: number;
  outstanding: number;
  penalty: number;
  /** Outstanding principal plus penalty, paid from the sale proceeds. */
  settlement: number;
  /** resale − settlement: positive is cash in, negative has to be paid. */
  net: number;
};

/** What selling in month `offset` after purchase brings once the loan is settled. Null when the loan has no sale. */
export function saleOutcome(item: LoanItem, t: LoanTerms): SaleOutcome | null {
  if (!item.sale) return null;
  const s = item.sale;
  const offset = s.afterMonths;
  const [first, last] = t.installmentOffsets;
  // The installment in the sale month is not paid: the loan is settled instead (an advance first one counts as paid).
  const installmentsPaid = t.installment > 0 ? Math.max(0, Math.min(last, offset - 1) - first + 1) : 0;
  const resaleEstimated = s.resaleAmount === undefined && s.resalePct === undefined;
  const resalePct = s.resaleAmount !== undefined ? (t.price ? Math.round((s.resaleAmount / t.price) * 1000) / 10 : 0) : (s.resalePct ?? defaultResalePct(offset));
  const resale = s.resaleAmount ?? Math.floor((t.price * resalePct) / 100 / RUPIAH) * RUPIAH;
  const outstanding = outstandingPrincipal(t, installmentsPaid);
  const penalty = roundUpRupiah((outstanding * s.settlementPenaltyPct) / 100);
  return { offset, resale, resalePct, resaleEstimated, installmentsPaid, outstanding, penalty, settlement: outstanding + penalty, net: resale - outstanding - penalty };
}
