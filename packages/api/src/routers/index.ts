import { schema } from "@baroka/db";
import { ORPCError } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authedProcedure, publicProcedure, readProcedure, sessionProcedure, writeProcedure } from "../index";
import { DEMO_TOKEN_DAYS, isDemoUser, refuseDemo } from "../lib/demo";
import * as account from "../services/account";
import * as accounts from "../services/accounts";
import * as attachments from "../services/attachments";
import * as reimburse from "../services/reimburse";
import * as dashboard from "../services/dashboard";
import * as demo from "../services/demo";
import { billingRouter } from "./billing";
import { householdRouter } from "./household";
import { captureRouter, joyoRouter } from "./joyo";
import { resolveCategory } from "../services/common";
import * as imports from "../services/imports";
import * as inbound from "../services/inbound";
import * as plan from "../services/plan";
import * as reports from "../services/reports";
import * as rules from "../services/rules";
import * as savings from "../services/savings";
import * as scenarios from "../services/scenarios";
import * as statements from "../services/statements";
import * as tokens from "../services/tokens";
import * as tx from "../services/transactions";
import { adminProcedure, waitlistRouter } from "./waitlist";

const byId = z.object({ id: z.string() });

/** Token management needs a signed-in browser session: a token or an AI connection cannot create more tokens. */
const sessionOnly = sessionProcedure;

export const appRouter = {
  me: authedProcedure.route({ method: "GET", path: "/me", tags: ["account"] }).handler(async ({ context }) => {
    const p = context.principal;
    const [user] = await context.db.select().from(schema.user).where(eq(schema.user.id, p.userId));
    const [household] = await context.db.select().from(schema.household).where(eq(schema.household.id, p.householdId));
    return {
      user: { id: p.userId, name: user?.name ?? null, email: user?.email ?? null, image: user?.image ?? null },
      household: { id: p.householdId, name: household?.name ?? null, baseCurrency: household?.baseCurrency ?? "IDR" },
      scopes: p.scopes,
      via: p.via,
      /** The store reviewers' demo account: made-up data that resets every day. */
      demo: isDemoUser(p.userId),
    };
  }),

  accounts: {
    list: readProcedure
      .route({ method: "GET", path: "/accounts", tags: ["accounts"], summary: "Accounts with balances" })
      .input(z.object({ includeArchived: z.boolean().optional() }))
      .handler(({ context, input }) => accounts.listAccounts(context.db, context.principal, input)),
    create: writeProcedure
      .route({ method: "POST", path: "/accounts", tags: ["accounts"] })
      .input(accounts.accountInput)
      .handler(({ context, input }) => accounts.createAccount(context.db, context.principal, input)),
    update: writeProcedure
      .route({ method: "PATCH", path: "/accounts/{id}", tags: ["accounts"] })
      .input(accounts.accountUpdate)
      .handler(({ context, input }) => accounts.updateAccount(context.db, context.principal, input)),
  },

  categories: {
    list: readProcedure
      .route({ method: "GET", path: "/categories", tags: ["categories"] })
      .handler(({ context }) => accounts.listCategories(context.db, context.principal)),
    create: writeProcedure
      .route({ method: "POST", path: "/categories", tags: ["categories"] })
      .input(accounts.categoryInput)
      .handler(({ context, input }) => accounts.createCategory(context.db, context.principal, input)),
  },

  transactions: {
    search: readProcedure
      .route({ method: "GET", path: "/transactions", tags: ["transactions"], summary: "Search transactions, newest first" })
      .input(tx.searchInput)
      .handler(({ context, input }) => tx.searchTransactions(context.db, context.principal, input)),
    add: writeProcedure
      .route({ method: "POST", path: "/transactions", tags: ["transactions"] })
      .input(tx.addInput)
      .handler(({ context, input }) => tx.addTransaction(context.db, context.principal, input)),
    quickAdd: writeProcedure
      .route({
        method: "POST",
        path: "/transactions/quick",
        tags: ["transactions"],
        summary: "Quick add a pending transaction (phone, Shortcut, voice); the next statement import confirms it",
      })
      .input(tx.quickAddInput)
      .handler(({ context, input }) => tx.quickAdd(context.db, context.principal, input)),
    update: writeProcedure
      .route({ method: "PATCH", path: "/transactions/{id}", tags: ["transactions"] })
      .input(tx.updateInput)
      .handler(({ context, input }) => tx.updateTransaction(context.db, context.principal, input)),
    delete: writeProcedure
      .route({ method: "DELETE", path: "/transactions/{id}", tags: ["transactions"] })
      .input(byId)
      .handler(({ context, input }) => tx.deleteTransaction(context.db, context.principal, input.id, context.files)),
    categorize: writeProcedure
      .route({ method: "POST", path: "/transactions/categorize", tags: ["transactions"], summary: "Set a category on transactions, optionally as a rule" })
      .input(tx.categorizeInput)
      .handler(async ({ context, input }) => {
        const { db, principal } = context;
        const cat = await resolveCategory(db, principal.householdId, input.category);
        const updated = await tx.setCategory(db, principal.householdId, input.ids, cat.id, input.merchant ? { merchant: input.merchant } : {});
        const rule = input.createRule
          ? await rules.createRule(db, principal, {
              ...input.createRule,
              category: cat.id,
              setMerchant: input.merchant,
              priority: 100,
            })
          : null;
        return { category: cat.slug, updated, rule: rule?.rule ?? null, ruleAppliedToExisting: rule?.appliedToExisting ?? 0 };
      }),
  },

  rules: {
    list: readProcedure
      .route({ method: "GET", path: "/rules", tags: ["rules"] })
      .handler(({ context }) => rules.listRules(context.db, context.principal)),
    create: writeProcedure
      .route({ method: "POST", path: "/rules", tags: ["rules"] })
      .input(rules.ruleInput)
      .handler(({ context, input }) => rules.createRule(context.db, context.principal, input)),
    delete: writeProcedure
      .route({ method: "DELETE", path: "/rules/{id}", tags: ["rules"] })
      .input(byId)
      .handler(({ context, input }) => rules.deleteRule(context.db, context.principal, input.id)),
    apply: writeProcedure
      .route({ method: "POST", path: "/rules/apply", tags: ["rules"], summary: "Run all rules over uncategorized transactions" })
      .handler(async ({ context }) => ({ categorized: await rules.applyRulesToUncategorized(context.db, context.principal.householdId) })),
  },

  budgets: {
    set: writeProcedure
      .route({ method: "PUT", path: "/budgets", tags: ["budgets"] })
      .input(reports.setBudgetInput)
      .handler(({ context, input }) => reports.setBudget(context.db, context.principal, input)),
    status: readProcedure
      .route({ method: "GET", path: "/budgets/status", tags: ["budgets"] })
      .input(reports.budgetStatusInput)
      .handler(({ context, input }) => reports.budgetStatus(context.db, context.principal, input)),
  },

  reports: {
    spending: readProcedure
      .route({ method: "GET", path: "/reports/spending", tags: ["reports"] })
      .input(reports.summaryInput)
      .handler(({ context, input }) => reports.spendingSummary(context.db, context.principal, input)),
    cashflow: readProcedure
      .route({ method: "GET", path: "/reports/cashflow", tags: ["reports"] })
      .input(reports.cashflowInput)
      .handler(({ context, input }) => reports.cashflow(context.db, context.principal, input)),
    dashboard: readProcedure
      .route({ method: "GET", path: "/reports/dashboard", tags: ["reports"], summary: "Everything the home screen shows for one month" })
      .input(dashboard.dashboardInput)
      .handler(({ context, input }) => dashboard.dashboard(context.db, context.principal, input)),
  },

  plan: {
    baseline: readProcedure
      .route({ method: "GET", path: "/plan/baseline", tags: ["plan"], summary: "Recurring income, core spending and liquid balances from the ledger" })
      .input(plan.baselineInput)
      .handler(({ context, input }) => plan.baseline(context.db, context.principal, input)),
    simulate: readProcedure
      .route({ method: "POST", path: "/plan/simulate", tags: ["plan"], summary: "Project a scenario (inline or saved) month by month and judge it (computes only)" })
      .input(plan.simulatePlanInput)
      .handler(({ context, input }) => plan.simulatePlan(context.db, context.principal, input)),
    compare: readProcedure
      .route({ method: "POST", path: "/plan/compare", tags: ["plan"], summary: "Several scenarios side by side against the same baseline" })
      .input(plan.comparePlanInput)
      .handler(({ context, input }) => plan.comparePlans(context.db, context.principal, input)),
    templates: readProcedure
      .route({ method: "GET", path: "/plan/templates", tags: ["plan"], summary: "Car loan, car upgrade path and baby templates with editable estimates" })
      .input(plan.templatesInput)
      .handler(({ input }) => plan.planTemplates(input)),
    savings: readProcedure
      .route({ method: "GET", path: "/plan/savings", tags: ["plan"], summary: "Where to save: everyday habits, a suggested cut for each, and what the cuts do to the plan (computes only)" })
      .input(savings.savingsInput)
      .handler(({ context, input }) => savings.savings(context.db, context.principal, input)),
    /** Saved scenarios, shared by everyone in the household. */
    scenarios: {
      list: readProcedure
        .route({ method: "GET", path: "/plan/scenarios", tags: ["plan"], summary: "The household's saved scenarios, most recently changed first" })
        .handler(({ context }) => scenarios.listScenarios(context.db, context.principal)),
      get: readProcedure
        .route({ method: "GET", path: "/plan/scenarios/{id}", tags: ["plan"] })
        .input(scenarios.scenarioIdInput)
        .handler(({ context, input }) => scenarios.getScenario(context.db, context.principal, input.id)),
      save: writeProcedure
        .route({ method: "PUT", path: "/plan/scenarios", tags: ["plan"], summary: "Save a scenario: by id, else replace the one with the same name, else create" })
        .input(scenarios.saveScenarioInput)
        .handler(({ context, input }) => scenarios.saveScenario(context.db, context.principal, input, context.billing)),
      delete: writeProcedure
        .route({ method: "DELETE", path: "/plan/scenarios/{id}", tags: ["plan"] })
        .input(scenarios.scenarioIdInput)
        .handler(({ context, input }) => scenarios.deleteScenario(context.db, context.principal, input.id)),
    },
  },

  imports: {
    transactions: writeProcedure
      .route({ method: "POST", path: "/imports", tags: ["imports"], summary: "Import parsed rows (preview, then commit)" })
      .input(imports.importInput)
      .handler(({ context, input }) => imports.importTransactions(context.db, context.principal, input)),
    csv: writeProcedure
      .route({ method: "POST", path: "/imports/csv", tags: ["imports"], summary: "Import a CSV or spreadsheet through a column mapping" })
      .input(imports.importCsvInput)
      .handler(({ context, input }) => imports.importCsv(context.db, context.principal, input)),
    statement: writeProcedure
      .route({ method: "POST", path: "/imports/statement", tags: ["imports"], summary: "Import a Bank Jago or GoPay statement from its PDF text (preview, then commit)" })
      .input(statements.statementInput)
      .handler(({ context, input }) => statements.importStatement(context.db, context.principal, input, { billing: context.billing })),
    statementFile: writeProcedure
      .route({
        method: "POST",
        path: "/imports/statement-file",
        tags: ["imports"],
        summary: "Import a Bank Jago or GoPay statement PDF (multipart/form-data: file, commit=true|false)",
        description:
          "Reads the PDF on the server the way the web app does and returns the same result as POST /imports/statement. Password-protected PDFs are refused with 400 and data.reason \"encrypted\".",
      })
      .input(statements.statementFileInput)
      .handler(({ context, input }) => statements.importStatementFile(context.db, context.principal, input, context.billing)),
    email: {
      get: sessionOnly
        .route({ method: "GET", path: "/imports/email", tags: ["imports"], summary: "The household's import email address and the last emails it received" })
        .handler(({ context }) => inbound.emailImportStatus(context.db, context.principal, context.config?.importEmailDomain ?? null)),
      regenerate: sessionOnly
        .route({ method: "POST", path: "/imports/email", tags: ["imports"], summary: "Turn on email import, or replace the address (the old one stops working)" })
        .handler(({ context }) => {
          refuseDemo(context.principal.userId, "emailImport");
          return inbound.regenerateEmailImport(context.db, context.principal, context.config?.importEmailDomain ?? null, context.billing);
        }),
      disable: sessionOnly
        .route({ method: "DELETE", path: "/imports/email", tags: ["imports"], summary: "Turn off email import" })
        .handler(({ context }) => inbound.disableEmailImport(context.db, context.principal, context.config?.importEmailDomain ?? null)),
    },
    list: readProcedure
      .route({ method: "GET", path: "/imports", tags: ["imports"] })
      .handler(({ context }) => imports.listImports(context.db, context.principal)),
    undo: writeProcedure
      .route({ method: "DELETE", path: "/imports/{id}", tags: ["imports"], summary: "Delete every transaction an import added" })
      .input(byId)
      .handler(({ context, input }) => imports.undoImport(context.db, context.principal, input.id, context.files)),
    mappings: readProcedure
      .route({ method: "GET", path: "/imports/mappings", tags: ["imports"] })
      .handler(({ context }) => imports.listMappings(context.db, context.principal)),
  },

  tokens: {
    list: sessionOnly
      .route({ method: "GET", path: "/tokens", tags: ["tokens"] })
      .handler(({ context }) => tokens.listTokens(context.db, context.principal)),
    create: sessionOnly
      .route({ method: "POST", path: "/tokens", tags: ["tokens"] })
      .input(tokens.createTokenInput)
      .handler(({ context, input }) => {
        if (!input.expiresInDays || input.expiresInDays > 1) refuseDemo(context.principal.userId, "longLivedToken");
        return tokens.createToken(context.db, context.principal, input);
      }),
    revoke: sessionOnly
      .route({ method: "DELETE", path: "/tokens/{id}", tags: ["tokens"] })
      .input(byId)
      .handler(({ context, input }) => tokens.revokeToken(context.db, context.principal, input.id)),
  },

  /** Data-subject rights: export, connected AI apps, deleting the account. Browser session only. */
  account: {
    export: sessionOnly
      .route({
        method: "GET",
        path: "/account/export",
        tags: ["account"],
        summary: "Download everything about you and your active household as JSON (session only)",
      })
      .handler(({ context }) => account.exportJsonFile(context.db, context.principal)),
    exportTransactionsCsv: sessionOnly
      .route({
        method: "GET",
        path: "/account/export/transactions.csv",
        tags: ["account"],
        summary: "Download the active household's transactions as CSV (session only)",
      })
      .handler(({ context }) => account.exportCsvFile(context.db, context.principal)),
    connections: sessionOnly
      .route({ method: "GET", path: "/account/connections", tags: ["account"], summary: "AI apps connected through OAuth (claude.ai, Claude Desktop)" })
      .handler(({ context }) => account.listConnections(context.db, context.principal)),
    disconnect: sessionOnly
      .route({
        method: "DELETE",
        path: "/account/connections/{clientId}",
        tags: ["account"],
        summary: "Disconnect an AI app: removes its consent and revokes its tokens",
      })
      .input(account.disconnectInput)
      .handler(({ context, input }) => account.disconnectApp(context.db, context.principal, input)),
    deletionPreview: sessionOnly
      .route({ method: "GET", path: "/account/deletion-preview", tags: ["account"], summary: "Which households deleting your account would delete, leave, or is blocked by" })
      .handler(({ context }) => account.accountDeletionPreview(context.db, context.principal)),
    delete: sessionOnly
      .route({
        method: "POST",
        path: "/account/delete",
        tags: ["account"],
        summary: "Delete your account (type your email to confirm); households where you are the only member go with it",
      })
      .input(account.deleteAccountInput)
      .handler(({ context, input }) => {
        refuseDemo(context.principal.userId, "deleteAccount");
        return account.deleteAccount(context.db, context.principal, input, context.files);
      }),
  },

  household: householdRouter,

  /** Receipt photos: private to the household, served only through these routes (no public URLs). */
  attachments: {
    upload: writeProcedure
      .route({
        method: "POST",
        path: "/attachments",
        tags: ["attachments"],
        summary: "Upload a receipt photo (multipart/form-data: file, transactionId?, replace?)",
      })
      .input(attachments.uploadInput)
      .handler(({ context, input }) => attachments.uploadAttachment(context.db, context.files, context.principal, input)),
    get: readProcedure
      .route({ method: "GET", path: "/attachments/{id}", tags: ["attachments"], summary: "The photo itself (image/jpeg or image/png), for members of its household" })
      .input(byId)
      .handler(({ context, input }) => attachments.getAttachmentFile(context.db, context.files, context.principal, input.id)),
    delete: writeProcedure
      .route({ method: "DELETE", path: "/attachments/{id}", tags: ["attachments"] })
      .input(byId)
      .handler(({ context, input }) => attachments.deleteAttachment(context.db, context.files, context.principal, input.id)),
  },

  /**
   * Reimbursable expenses ("Diganti kantor"): employer profiles, marking items, and claim reports (PDF/CSV) to email
   * or print for approval. Open items are transfers into the employer's receivable, not household spending.
   */
  reimburse: {
    profiles: {
      list: readProcedure
        .route({ method: "GET", path: "/reimburse/profiles", tags: ["reimburse"], summary: "Who pays expenses back (employers), with what each still owes" })
        .input(z.object({ includeArchived: z.boolean().optional() }))
        .handler(({ context, input }) => reimburse.listProfiles(context.db, context.principal, input)),
      create: writeProcedure
        .route({ method: "POST", path: "/reimburse/profiles", tags: ["reimburse"], summary: "Add an employer profile (and its receivable account)" })
        .input(reimburse.profileInput)
        .handler(({ context, input }) => reimburse.createProfile(context.db, context.principal, input)),
      update: writeProcedure
        .route({ method: "PATCH", path: "/reimburse/profiles/{id}", tags: ["reimburse"] })
        .input(reimburse.profileUpdate)
        .handler(({ context, input }) => reimburse.updateProfile(context.db, context.principal, input)),
      delete: writeProcedure
        .route({ method: "DELETE", path: "/reimburse/profiles/{id}", tags: ["reimburse"], summary: "Delete an unused profile, or archive a used one" })
        .input(byId)
        .handler(({ context, input }) => reimburse.deleteProfile(context.db, context.principal, input.id)),
    },
    mark: writeProcedure
      .route({ method: "POST", path: "/reimburse/mark", tags: ["reimburse"], summary: "Mark expenses reimbursable for a profile (draft), or unmark them" })
      .input(reimburse.markInput)
      .handler(({ context, input }) => reimburse.markReimbursable(context.db, context.principal, input)),
    items: readProcedure
      .route({ method: "GET", path: "/reimburse/items", tags: ["reimburse"], summary: "Reimbursable expenses, oldest first (default: open = draft and submitted)" })
      .input(reimburse.itemsInput)
      .handler(({ context, input }) => reimburse.listItems(context.db, context.principal, input)),
    claims: {
      list: readProcedure
        .route({ method: "GET", path: "/reimburse/claims", tags: ["reimburse"], summary: "Claim reports, newest first" })
        .input(reimburse.claimsInput)
        .handler(({ context, input }) => reimburse.listClaims(context.db, context.principal, input)),
      get: readProcedure
        .route({ method: "GET", path: "/reimburse/claims/{id}", tags: ["reimburse"] })
        .input(byId)
        .handler(({ context, input }) => reimburse.getClaim(context.db, context.principal, input.id)),
      create: writeProcedure
        .route({ method: "POST", path: "/reimburse/claims", tags: ["reimburse"], summary: "Generate a claim report from draft items (marks them submitted); then GET its pdf or csv" })
        .input(reimburse.createClaimInput)
        .handler(({ context, input }) => reimburse.createClaim(context.db, context.principal, input, context.billing)),
      setStatus: writeProcedure
        .route({ method: "POST", path: "/reimburse/claims/{id}/status", tags: ["reimburse"], summary: "Mark a claim paid (optionally with the employer's payment), rejected, or submitted again" })
        .input(reimburse.claimStatusInput)
        .handler(({ context, input }) => reimburse.setClaimStatus(context.db, context.principal, input)),
      delete: writeProcedure
        .route({ method: "DELETE", path: "/reimburse/claims/{id}", tags: ["reimburse"], summary: "Withdraw a submitted claim: its items go back to draft" })
        .input(byId)
        .handler(({ context, input }) => reimburse.deleteClaim(context.db, context.principal, input.id)),
      pdf: readProcedure
        .route({ method: "GET", path: "/reimburse/claims/{id}/pdf", tags: ["reimburse"], summary: "The claim report as PDF, receipt photos in the appendix" })
        .input(byId)
        .handler(({ context, input }) => reimburse.claimPdfFile(context.db, context.files, context.principal, input.id)),
      csv: readProcedure
        .route({ method: "GET", path: "/reimburse/claims/{id}/csv", tags: ["reimburse"], summary: "The claim report as CSV" })
        .input(byId)
        .handler(({ context, input }) => reimburse.claimCsvFile(context.db, context.principal, input.id)),
    },
  },

  /** JoyoArto Pro for the household: prices, plan and usage, checkout (DOKU, Polar), orders. */
  billing: billingRouter,

  /** Joyo AI, the in-app finance chat (tools: src/tools.ts entries marked `chat`). */
  joyo: joyoRouter,

  /** The add sheet's voice note and free-text capture (draft only; saving is transactions.quickAdd). */
  capture: captureRouter,

  waitlist: waitlistRouter,

  /**
   * The demo account for store reviewers (Google Play, App Store) and screenshots. Off unless the server has the secret
   * DEMO_LOGIN_CODE. The web app signs in with POST /api/auth/sign-in/demo (packages/auth); the phone app uses `token`.
   */
  demo: {
    token: publicProcedure
      .route({
        method: "POST",
        path: "/demo/token",
        tags: ["demo"],
        summary: `Demo code to a ${DEMO_TOKEN_DAYS}-day token for the demo account (resets its made-up data)`,
      })
      .input(z.object({ code: z.string().trim().min(1).max(200) }))
      .handler(async ({ context, input }) => {
        const req = context.request;
        if (req?.allow && !(await req.allow("demo", req.ip ?? "unknown"))) {
          throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a minute." });
        }
        return demo.demoToken(context.db, input.code, context.config?.demoCode);
      }),
    reset: adminProcedure
      .route({ method: "POST", path: "/admin/demo/reset", tags: ["demo"], summary: "Create or reset the demo account's data (operators)" })
      .handler(({ context }) => demo.seedDemo(context.db)),
  },
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
