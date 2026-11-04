// The tools Claude gets, in one list: the MCP server (apps/server/src/mcp.ts) registers every entry, and Joyo AI (the
// in-app chat, lib/joyo-ai) uses the ones marked `chat`. Each tool calls the same oRPC procedure as the REST API, under
// the caller's principal, so both only ever see the caller's household.
//
// Procedures are reached through functions: routers/index.ts imports Joyo AI, which imports this list, so reading
// `appRouter` at module load would hit the import cycle before the router exists.

import type { AnyProcedure } from "@orpc/server";
import { z } from "zod";

import type { Scope } from "./context";
import { appRouter } from "./routers/index";

export const MCP_INSTRUCTIONS = `JoyoArto is the user's personal finance ledger (bank accounts, cards, e-wallets in Indonesia).

Money: every amount is an integer in minor units of its currency. IDR has 2 decimals, so Rp 25.000 = 2500000 and Rp 1.250.000,50 = 125000050. Results also carry a "display" string; quote that to the user instead of doing the conversion yourself.
Signs: transaction amounts are from the account's point of view: negative = money out (debit, spending, card purchase), positive = money in (credit, salary, refund).
Dates: transaction dates are calendar days (YYYY-MM-DD) as the bank printed them. Months are YYYY-MM. "This month" is in WIB (UTC+7).
Categories are referred to by slug ("food/groceries"); call list_categories for the valid ones. Transfers between the user's own accounts, e-wallet top-ups and credit-card payments use the transfer/* categories and are not counted as spending or income.

Bank Jago monthly statements and GoPay e-statements: if you can get the PDF's text, prefer import_statement_text (JoyoArto parses and verifies them itself).

Importing any other bank statement (PDF, screenshot, CSV pasted in chat):
1. list_accounts, and pick the account the statement belongs to (match bank and last digits). If none fits, ask before create_account.
2. Read every transaction row. Keep the description verbatim. Convert amounts to signed minor units: debit/DB/keluar = negative, credit/CR/masuk = positive. For a credit-card statement, purchases are negative and payments to the card are positive. Include balanceAfter when the statement prints a running balance. Skip opening/closing balance lines and subtotals.
3. Call import_transactions with commit=false. Check balanceCheck.mismatches (they mean a sign or digit was misread) and fix the rows before committing. Duplicates of rows imported before are skipped automatically, so overlapping statements are safe.
4. Call again with commit=true. Rows matching a pending quick add (same amount, within a day) replace it: see reconciled and unmatchedPending in the result. Then offer to categorise what is left uncategorised (search_transactions uncategorized=true, then categorize with createRule for recurring merchants).

Quick capture: when the user mentions spending ("tadi beli kopi 25rb"), use quick_add. It is pending until the statement arrives.

Planning ("can we afford a car?", "what if we have a baby?"): call plan_baseline first and show the user the recurring income, core spending, excluded one-offs and account roles it found; ask them to correct anything wrong. Ask the user for the car's price, down payment, tenor and the dealer's interest rate (and whether it is flat or effective) instead of inventing them; plan_templates has rough estimates for running costs and baby costs, which you must present as estimates. Then use simulate_plan, or compare_plans for several options (it adds a "No change" scenario). For "buy a small car now and a bigger one later", give the first loan a sale (afterMonths, resalePct or resaleAmount) and add the second car as another loan in the sale month (plan_templates has an example); the sale settles what is left of the first loan. Present the verdict with its reasons and numbers, and the assumptions (including the resale estimate); never present it as certain or as financial advice. simulate_plan and compare_plans only compute. Saved scenarios are shared with everyone in the household (they also show on the web Plan page): list_scenarios shows them, and simulate_plan/compare_plans take their ids; save_scenario only when the user asks to keep one, and confirm before delete_scenario.

Write tools change the user's data: confirm with the user before bulk changes they did not ask for.`;

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  procedure: () => AnyProcedure;
  /**
   * Joyo AI: "read" tools run as the model asks; "propose" tools (writes) only become a suggestion the member confirms
   * in the chat, and then run with exactly the proposed arguments. Absent = not offered in the chat.
   */
  chat?: "read" | "propose";
  input?: () => z.ZodObject;
  readOnly?: boolean;
  destructive?: boolean;
  /** Arguments filled in when the caller leaves them out. */
  defaults?: Record<string, unknown>;
};

const TOOLS: () => ToolDef[] = () => [
  {
    name: "list_accounts",
    chat: "read",
    title: "List accounts",
    description: "The user's bank accounts, cards, e-wallets and cash, with id, institution, last digits, computed balance, transaction count and the date range already imported. Call first to find account ids.",
    scope: "finance:read",
    procedure: () => appRouter.accounts.list,
    input: () => z.object({ includeArchived: z.boolean().optional() }),
    
    readOnly: true,
  },
  {
    name: "list_categories",
    chat: "read",
    title: "List categories",
    description: "Every category: slug (use this to refer to it), name and kind (expense, income, transfer).",
    scope: "finance:read",
    procedure: () => appRouter.categories.list,
    readOnly: true,
  },
  {
    name: "search_transactions",
    chat: "read",
    title: "Search transactions",
    description: "Transactions newest first, filtered by date range, account, category (includes subcategories), uncategorized, text (description/merchant/note), direction and absolute amount bounds. Paginated: pass nextCursor back as cursor.",
    scope: "finance:read",
    procedure: () => appRouter.transactions.search,
    readOnly: true,
  },
  {
    name: "spending_summary",
    chat: "read",
    title: "Spending or income summary",
    description: "Totals for a date range grouped by category (top level), subcategory, merchant, month or account, with share of total and counts. kind=expense (default) reports spending as positive numbers; kind=income reports income. Transfers are excluded. Default range: this month.",
    scope: "finance:read",
    procedure: () => appRouter.reports.spending,
    readOnly: true,
  },
  {
    name: "cashflow",
    chat: "read",
    title: "Monthly cashflow",
    description: "Income, spending, net and savings rate per month (default: the last 6 months), excluding transfers.",
    scope: "finance:read",
    procedure: () => appRouter.reports.cashflow,
    readOnly: true,
  },
  {
    name: "month_dashboard",
    title: "Month dashboard",
    description: "Everything the JoyoArto home screen shows for one month (default: this month, WIB): income, spending, net, top categories and merchants, budgets, pending quick adds and account balances.",
    scope: "finance:read",
    procedure: () => appRouter.reports.dashboard,
    readOnly: true,
    chat: "read",
  },
  {
    name: "budget_status",
    chat: "read",
    title: "Budget status",
    description: "Each monthly budget with spent, remaining, percent used and where spending should be by today if spread evenly (pacePct); status is on_track, ahead_of_pace or over.",
    scope: "finance:read",
    procedure: () => appRouter.budgets.status,
    readOnly: true,
  },
  {
    name: "plan_baseline",
    chat: "read",
    title: "Planning baseline",
    description: "Starting point for affordability planning, from the last complete months (default 6): recurring income per source (irregular income such as gifts, refunds and other income excluded; salary paid at month end for the next month detected), core monthly spending with large one-offs excluded (and listed), existing loan installments found in transfers, liquid balances per account with a suggested role (emergency, goal, spending, exclude) and free cash flow. Call before simulate_plan or compare_plans.",
    scope: "finance:read",
    procedure: () => appRouter.plan.baseline,
    readOnly: true,
  },
  {
    name: "plan_templates",
    chat: "read",
    title: "Planning templates",
    description: "Ready-made scenario items with rough Indonesian estimates: a car loan (KKB: DP 30%, 48 months, flat rate placeholder, insurance, fees, PKB, running costs), a baby (check-ups, birth normal/caesarean, gear, monthly costs rising over the first year) and a car upgrade path (Wuling Aira EV LR now with the dealer's quote, sold after sellAfterMonths (default 18) at an estimated EV resale value, then a Geely EX2 Max in the sale month). Every default is an estimate to confirm with the user.",
    scope: "finance:read",
    procedure: () => appRouter.plan.templates,
    readOnly: true,
  },
  {
    name: "simulate_plan",
    chat: "read",
    title: "Simulate a plan",
    description: "Projects one scenario month by month (default 36 months from next month) on top of the ledger baseline: loans (car KKB with DP, tenor, flat or effective rate or the dealer's quoted installment, fees, insurance, running costs, PKB, and optionally a sale after some months whose proceeds settle the loan), one-off costs or inflows, recurring costs and income changes. Returns loan installments and total cost, balances per role, safety rules (emergency fund ≥ 6 months of new outflow, installments ≤ 30% of income and car ≤ 20%, no negative balance, goal savings rebuilt) and a verdict (comfortable, tight, risky) with reasons and assumptions. Baseline figures can be overridden. Pass scenarioId to run a saved scenario (its own overrides apply; fields given here override them, items replace them). Computes only; saves nothing.",
    scope: "finance:read",
    procedure: () => appRouter.plan.simulate,
    readOnly: true,
  },
  {
    name: "compare_plans",
    chat: "read",
    title: "Compare plans",
    description: "Runs up to 6 scenarios (e.g. Car A, Car B, no car; each with its items) against the same baseline and returns them side by side: installment, upfront cash, lowest balance, emergency-fund coverage, debt ratio, verdict and reasons. Adds a \"No change\" scenario unless one is empty. A scenario can be {name, items} or {scenarioId} of a saved one (its items run against this call's baseline; notes say when a saved scenario had its own overrides). Computes only; saves nothing.",
    scope: "finance:read",
    procedure: () => appRouter.plan.compare,
    readOnly: true,
  },
  {
    name: "list_scenarios",
    chat: "read",
    title: "List saved scenarios",
    description: "The household's saved plan scenarios (shared by its members and shown on the web Plan page), most recently changed first: id, name, the plan (items and baseline overrides), who created and last changed it. Pass an id to simulate_plan (scenarioId) or compare_plans (scenarios[].scenarioId).",
    scope: "finance:read",
    procedure: () => appRouter.plan.scenarios.list,
    readOnly: true,
  },
  {
    name: "save_scenario",
    chat: "propose",
    title: "Save a scenario",
    description: "Saves a plan scenario for the household: name plus plan (items and any baseline overrides, exactly as simulate_plan takes them). With id it updates that scenario; without, a scenario of the same name is replaced, else a new one is created (at most 50). Everyone in the household sees it. Only when the user asks to keep a scenario.",
    scope: "finance:write",
    procedure: () => appRouter.plan.scenarios.save,
  },
  {
    name: "delete_scenario",
    title: "Delete a saved scenario",
    description: "Deletes one saved scenario by id, for everyone in the household. Confirm with the user first.",
    scope: "finance:write",
    procedure: () => appRouter.plan.scenarios.delete,
    destructive: true,
  },
  {
    name: "household_info",
    chat: "read",
    title: "Household info",
    description: "The household this ledger belongs to: its name, your role (owner or member) and its members (name, email, role, joined). Owners also see pending invites.",
    scope: "finance:read",
    procedure: () => appRouter.household.get,
    readOnly: true,
  },
  {
    name: "list_rules",
    chat: "read",
    title: "List categorisation rules",
    description: "Auto-categorisation rules applied to new transactions, in priority order.",
    scope: "finance:read",
    procedure: () => appRouter.rules.list,
    readOnly: true,
  },
  {
    name: "add_transaction",
    title: "Add a transaction",
    description: "Records one transaction by hand (cash spending, something not on a statement yet). Amount is signed minor units. Idempotent: the same account, date, amount and description is not added twice.",
    scope: "finance:write",
    procedure: () => appRouter.transactions.add,
  },
  {
    name: "quick_add",
    chat: "propose",
    title: "Quick add (pending)",
    description:
      'Records spending or income the user just mentioned ("kopi 25rb", "parkir 5 ribu pakai GoPay") as a pending transaction. amountText takes shorthand like "25rb", "Rp 25.000", "1,5jt" (money out unless direction=in); accountId defaults to the most used account. It counts in reports at once, and the next statement import of that account confirms and replaces it (same amount within a day), keeping its category, merchant and note. Prefer this over add_transaction for anything a statement will show later.',
    scope: "finance:write",
    procedure: () => appRouter.transactions.quickAdd,
    defaults: { capturedVia: "mcp" },
  },
  {
    name: "update_transaction",
    chat: "propose",
    title: "Edit a transaction",
    description: "Changes the category, merchant name or note of one transaction. A statement's description, date and amount never change; on pending (quick-add) rows they can also be corrected.",
    scope: "finance:write",
    procedure: () => appRouter.transactions.update,
    readOnly: false,
  },
  {
    name: "categorize",
    chat: "propose",
    title: "Categorise transactions",
    description: "Sets one category (and optionally a merchant name) on many transactions. With createRule, also remembers it for future imports and applies it to past uncategorised matches. Prefer field=merchant, match=equals for recurring merchants; use description contains for bank codes.",
    scope: "finance:write",
    procedure: () => appRouter.transactions.categorize,
  },
  {
    name: "create_rule",
    chat: "propose",
    title: "Create a categorisation rule",
    description: "A rule that sets a category and/or merchant name on transactions whose merchant or description matches (case-insensitive), optionally only for one account, direction or amount range. Applies to past uncategorised transactions too unless applyToExisting=false.",
    scope: "finance:write",
    procedure: () => appRouter.rules.create,
  },
  {
    name: "set_budget",
    chat: "propose",
    title: "Set a monthly budget",
    description: "Sets the monthly limit of an expense category (its subcategories count toward it). Amount in minor units; 0 removes it.",
    scope: "finance:write",
    procedure: () => appRouter.budgets.set,
  },
  {
    name: "create_account",
    title: "Create an account",
    description: "Adds a bank account, credit card, e-wallet or cash wallet. Ask the user before creating one.",
    scope: "finance:write",
    procedure: () => appRouter.accounts.create,
  },
  {
    name: "create_category",
    title: "Create a category",
    description: 'Adds a category: "pets" or a subcategory "food/snacks" (the parent must exist).',
    scope: "finance:write",
    procedure: () => appRouter.categories.create,
  },
  {
    name: "import_transactions",
    title: "Import statement rows",
    description: "Imports transactions read from a bank, card or e-wallet statement into one account. Always call with commit=false first: it returns the new rows (duplicates of earlier imports are skipped), totals, a running-balance check and uncategorised count without saving. Then call again with the same rows and commit=true. At most 2000 rows per call; send rows in statement order.",
    scope: "finance:write",
    procedure: () => appRouter.imports.transactions,
  },
  {
    name: "import_statement_text",
    title: "Import a Jago or GoPay statement (text)",
    description: "For Bank Jago monthly statements and GoPay e-statements only: pass the PDF's extracted text and JoyoArto parses it itself, one account per Jago pocket, every running balance verified, and GoPay merchants merged into Jago payments. Preview with commit=false first. For other banks use import_transactions.",
    scope: "finance:write",
    procedure: () => appRouter.imports.statement,
  },
  {
    name: "list_imports",
    chat: "read",
    title: "List imports",
    description: "Recent imports: account, source, file name, period, rows inserted and skipped as duplicates.",
    scope: "finance:read",
    procedure: () => appRouter.imports.list,
    readOnly: true,
  },
  {
    name: "undo_import",
    title: "Undo an import",
    description: "Deletes every transaction one import added (by import id from list_imports or import_transactions' batchId). Use it to redo a statement that was read wrongly. Confirm with the user first.",
    scope: "finance:write",
    procedure: () => appRouter.imports.undo,
    destructive: true,
  },
];

let cached: ToolDef[] | null = null;

/** Every tool, in the order the MCP server lists them. */
export function toolCatalog(): ToolDef[] {
  cached ??= TOOLS();
  return cached;
}

/** The zod object a tool's procedure validates its input with, so every client advertises the same schema. */
export function toolInput(def: ToolDef): z.ZodObject | undefined {
  if (def.input) return def.input();
  const s = (def.procedure() as unknown as { "~orpc": { inputSchema?: unknown } })["~orpc"].inputSchema;
  return s instanceof z.ZodObject ? s : undefined;
}
