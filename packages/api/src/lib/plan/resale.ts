// Resale estimates for selling a car partway through a plan. Assumptions, not market data: used EVs in Indonesia have
// lost value fast (frequent new models, price cuts on new cars, worries about battery life), so the default is steeper
// than for petrol cars. Show it as an estimate and use a dealer's trade-in offer when there is one.

export const EV_DEPRECIATION = {
  /** Share of the OTR price lost over the first 12 months, spread evenly over them. */
  firstYearPct: 35,
  /** Share of the OTR price lost each later year, spread evenly over its months. */
  laterYearPct: 10,
  /** The estimate never goes below this share of the OTR price. */
  floorPct: 15,
} as const;

/** Estimated resale value after `months` as % of the OTR price (one decimal): 65% after a year, 60% after 18 months. */
export function defaultResalePct(months: number): number {
  const m = Math.max(0, months);
  const lost = (EV_DEPRECIATION.firstYearPct * Math.min(m, 12)) / 12 + (EV_DEPRECIATION.laterYearPct * Math.max(0, m - 12)) / 12;
  return Math.round(Math.max(EV_DEPRECIATION.floorPct, 100 - lost) * 10) / 10;
}

export const RESALE_ASSUMPTION = `Resale value, unless entered: an estimate for battery EVs in Indonesia of ${EV_DEPRECIATION.firstYearPct}% of the OTR price lost in the first year and ${EV_DEPRECIATION.laterYearPct}% a year after (at least ${EV_DEPRECIATION.floorPct}% left), e.g. ${defaultResalePct(12)}% after 12 months and ${defaultResalePct(18)}% after 18. Used EV prices move fast; get a trade-in quote.`;
