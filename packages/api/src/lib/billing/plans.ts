// What Free and Pro include. The one place to change a limit: the server enforces these (services/billing.ts), the web
// app shows them from billing.status, and the pricing page lists them. Prices live in wrangler vars (config.ts).
//
// A self-hosted server without billing configured (no PAYWALL=1 or no payment gateway) gives every household Pro:
// JoyoArto is AGPL and free to run yourself; the limits only exist on the hosted service.

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export type PlanLimits = {
  /** Bank statement imports (Jago/GoPay PDF or text, app, share-to-app, API upload) per household per WIB month; null = unlimited. */
  statementImportsPerMonth: number | null;
  /** Several statements in one go on the import page. */
  bulkStatementImport: boolean;
  /** Statements forwarded to the household's import address. */
  emailImport: boolean;
  /** Hosted Joyo AI questions per member per WIB day; null = the server's JOYO_AI_DAILY_CAP. Own keys are not limited by plan. */
  aiDailyCap: number | null;
  /** Household members, pending invites included. */
  members: number;
  /** Saved Plan & simulate scenarios (0 = drafts only; existing ones stay readable). */
  savedScenarios: number;
  /** The Claude connector (MCP: claude.ai, Claude Desktop, Claude Code). The REST API and phone app work on Free too. */
  mcpConnector: boolean;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    statementImportsPerMonth: 2,
    bulkStatementImport: false,
    emailImport: false,
    aiDailyCap: 5,
    members: 2,
    savedScenarios: 0,
    mcpConnector: false,
  },
  pro: {
    statementImportsPerMonth: null,
    bulkStatementImport: true,
    emailImport: true,
    aiDailyCap: null,
    members: 6,
    savedScenarios: 50,
    mcpConnector: true,
  },
};

/** Features that can ask for an upgrade; the web app keys its prompt copy on these. */
export const UPGRADE_FEATURES = ["statementImports", "bulkImport", "emailImport", "joyoAi", "members", "savedScenarios", "mcpConnector"] as const;
export type UpgradeFeature = (typeof UPGRADE_FEATURES)[number];

/** Usage counter metric for statement imports (usage_counter.metric). */
export const STATEMENT_IMPORT_METRIC = "statement_import";
