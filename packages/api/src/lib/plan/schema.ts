// Inputs of the planner: scenario items and baseline overrides. Shared by the pure simulator, the API and the MCP tools.
import { z } from "zod";

const month = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");
const minor = z.number().int().min(0);
const pct = z.number().min(0).max(100);

export const ROLES = ["emergency", "goal", "spending"] as const;
export type Role = (typeof ROLES)[number];
/** What an account counts as in a plan; "exclude" leaves it out of liquid balances. */
export const ACCOUNT_ROLES = [...ROLES, "exclude"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const fundedFrom = z
  .string()
  .default("goal")
  .describe('Where upfront cash comes from: "emergency", "goal", "spending" or an account id. Any shortfall is taken from spending, then goal, then emergency.');

/** Selling the financed asset after a while: proceeds first settle what is left of the loan. */
export const saleTerms = z.object({
  afterMonths: z
    .number()
    .int()
    .min(1)
    .max(120)
    .describe("Months after the purchase month in which it is sold. Installments and running costs stop that month; proceeds arrive that month."),
  resalePct: pct
    .optional()
    .describe("Sale price as % of the OTR price. Default (when resaleAmount is not given either): the Indonesian EV estimate, 35% lost in year one, then 10% of the price a year, at least 15% left."),
  resaleAmount: minor.optional().describe("Sale price in minor units (instead of resalePct)"),
  settlementPenaltyPct: pct.default(0).describe("Early-settlement penalty, % of the outstanding principal (ask the lender; often 0–5%)"),
  proceedsTo: z.string().default("goal").describe('Where net sale proceeds go: "emergency", "goal", "spending" or an account id. A shortfall (loan larger than the sale price) is paid from here first.'),
});
export type SaleTerms = z.infer<typeof saleTerms>;

export const loanItem = z.object({
  type: z.literal("loan"),
  id: z.string().max(40).optional(),
  label: z.string().max(80).default("Car loan"),
  asset: z.enum(["car", "other"]).default("car").describe("Car loans are also checked against the 20%-of-income rule"),
  month: month.optional().describe("Purchase month; default: the plan's start month"),
  price: minor.describe("On-the-road price (OTR), minor units"),
  downPayment: minor.optional().describe("Down payment in minor units; or use downPaymentPct"),
  downPaymentPct: pct.optional().describe("Down payment as % of price (used when downPayment is not given)"),
  fundedFrom,
  tenorMonths: z.number().int().min(1).max(120),
  ratePct: z.number().min(0).max(60).optional().describe("Interest rate, % per year. Required unless installment is given."),
  installment: minor
    .optional()
    .describe("Monthly installment as the dealer quotes it; when given it is used as is and the rate it implies is reported (ratePct is ignored)"),
  rateType: z.enum(["flat", "effective"]).default("flat").describe("flat: interest on the original principal for the whole tenor (how Indonesian car loans are usually quoted). effective: annuity on the declining balance."),
  payment: z.enum(["arrears", "advance"]).default("arrears").describe("advance (ADDM): the first installment is paid upfront with the down payment"),
  insuranceFirstYear: minor.optional().describe("First-year insurance premium; or insuranceFirstYearPct"),
  insuranceFirstYearPct: pct.optional().describe("First-year premium as % of price"),
  insuranceFinanced: z.boolean().default(false).describe("true: the premium is added to the loan principal instead of paid upfront"),
  insuranceRenewalPct: pct.default(0).describe("Yearly premium from year 2, as % of price"),
  adminFee: minor.default(0),
  provisionPct: pct.default(0).describe("Provision fee, % of the amount financed"),
  feesFinanced: z.boolean().default(false).describe("true: admin and provision fees are added to the principal"),
  fuelMonthly: minor.default(0),
  parkingTollMonthly: minor.default(0),
  maintenanceMonthly: minor.default(0),
  annualTax: minor.optional().describe("PKB per year, from the second year (the first is in the OTR price); or annualTaxPct"),
  annualTaxPct: pct.optional().describe("PKB per year as % of price"),
  savesMonthly: minor.default(0).describe("Spending the car replaces each month (ride-hailing, taxis)"),
  sale: saleTerms.optional().describe("Sell it after some months (an upgrade path: add the next car as another loan in the sale month)"),
}).refine((x) => x.ratePct !== undefined || x.installment !== undefined, { message: "Give ratePct or installment", path: ["ratePct"] });

export const oneOffItem = z.object({
  type: z.literal("oneOff"),
  id: z.string().max(40).optional(),
  label: z.string().max(80),
  month: month.optional().describe("Default: the plan's start month"),
  amount: minor,
  direction: z.enum(["out", "in"]).default("out").describe('"in" for money received (selling the old car, a bonus)'),
  fundedFrom,
});

export const recurringItem = z.object({
  type: z.literal("recurring"),
  id: z.string().max(40).optional(),
  label: z.string().max(80),
  startMonth: month.optional().describe("Default: the plan's start month"),
  endMonth: month.optional().describe("Last month, inclusive"),
  months: z.number().int().min(1).max(600).optional().describe("Number of months (used when endMonth is not given)"),
  monthly: minor.describe("Monthly cost"),
  rampTo: minor.optional().describe("Rises linearly from monthly to this amount over rampMonths"),
  rampMonths: z.number().int().min(1).max(120).optional(),
  annualIncreasePct: z.number().min(0).max(100).default(0).describe("Step increase every 12 months"),
});

export const incomeChangeItem = z.object({
  type: z.literal("incomeChange"),
  id: z.string().max(40).optional(),
  label: z.string().max(80),
  startMonth: month.optional(),
  endMonth: month.optional().describe("Last month, inclusive"),
  mode: z.enum(["delta", "replace"]).default("delta").describe("delta: add amount (negative to reduce) to monthly income; replace: monthly income becomes amount"),
  amount: z.number().int(),
});

/** Spending the household chooses to cut (a habit from spending_cuts): lowers the monthly outflow by `monthly`. */
export const cutItem = z.object({
  type: z.literal("cut"),
  id: z.string().max(40).optional().describe('spending_cuts uses "cut:<habit key>", so adding the cuts again replaces them'),
  label: z.string().max(80),
  monthly: minor.describe("Monthly saving: how much less is spent each month"),
  startMonth: month.optional().describe("Default: the plan's start month"),
  endMonth: month.optional().describe("Last month, inclusive"),
  habit: z.string().max(60).optional().describe("The habit key from spending_cuts (a category slug or \"minimarket\")"),
});

export const scenarioItem = z.discriminatedUnion("type", [loanItem, oneOffItem, recurringItem, incomeChangeItem, cutItem]);
export type LoanItem = z.infer<typeof loanItem>;
export type OneOffItem = z.infer<typeof oneOffItem>;
export type RecurringItem = z.infer<typeof recurringItem>;
export type IncomeChangeItem = z.infer<typeof incomeChangeItem>;
export type CutItem = z.infer<typeof cutItem>;
export type ScenarioItem = z.infer<typeof scenarioItem>;
export type ScenarioItemInput = z.input<typeof scenarioItem>;

export const ruleOptions = z.object({
  emergencyMonths: z.number().min(0).max(24).default(6).describe("Months of outflow the emergency fund should cover"),
  maxDebtPct: z.number().min(0).max(100).default(30).describe("All installments as % of income"),
  maxCarPct: z.number().min(0).max(100).default(20).describe("Car installments as % of income"),
});
export type RuleOptions = z.infer<typeof ruleOptions>;

export const planInput = z.object({
  monthlyIncome: z.number().int().optional().describe("Override the recurring income from the ledger (minor units)"),
  monthlySpending: minor.optional().describe("Override the core monthly spending from the ledger (minor units)"),
  existingInstallments: minor.optional().describe("Loan installments already paid each month (default: transfer categories named like loans)"),
  roles: z.record(z.string(), z.enum(ACCOUNT_ROLES)).optional().describe('Account id -> "emergency" | "goal" | "spending" | "exclude"'),
  balances: z.record(z.string(), z.number().int()).optional().describe("Account id -> balance to use instead of the ledger's"),
  startingBalances: z
    .object({ emergency: z.number().int().optional(), goal: z.number().int().optional(), spending: z.number().int().optional() })
    .optional()
    .describe("Totals per role; override what the accounts add up to"),
  startMonth: month.optional().describe("First projected month; default: next month"),
  horizonMonths: z.number().int().min(1).max(120).default(36),
  baselineMonths: z.number().int().min(3).max(24).default(6).describe("Complete months of history the baseline uses"),
  rules: ruleOptions.optional(),
});

export const simulateInput = planInput.extend({
  items: z.array(scenarioItem).max(30).default([]),
});

export const compareInput = planInput.extend({
  scenarios: z
    .array(z.object({ name: z.string().min(1).max(60), items: z.array(scenarioItem).max(30).default([]) }))
    .min(1)
    .max(6),
  includeBaseline: z.boolean().default(true).describe('Add a "No change" scenario when none of the scenarios is empty'),
});

/** What a saved scenario stores: baseline overrides and the scenario's items. */
export const savedPlan = simulateInput;
export type SavedPlan = z.infer<typeof savedPlan>;

/** Plan fields without defaults, so a call can override only what it names on top of a saved scenario. */
export const planOverrides = z.object({
  ...planInput.shape,
  horizonMonths: z.number().int().min(1).max(120).optional().describe("Default 36, or the saved scenario's"),
  baselineMonths: z.number().int().min(3).max(24).optional().describe("Default 6, or the saved scenario's"),
  items: z.array(scenarioItem).max(30).optional().describe("Replaces the saved scenario's items when given"),
});
