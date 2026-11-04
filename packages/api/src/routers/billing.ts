import { authedProcedure, publicProcedure } from "../index";
import * as billing from "../services/billing";

const tags = ["billing"];

/**
 * Joyo Pro, per account. JoyoArto sells nothing: Joyo Pro is bought and managed in JoyoRogo (`proUrl`), and this server
 * only reads its status (services/billing.ts). Prices are JoyoRogo's own, read from its public config.
 */
export const billingRouter = {
  pricing: publicProcedure
    .route({ method: "GET", path: "/billing/pricing", tags, summary: "Joyo Pro prices (JoyoRogo's), where to buy it, and what Free and Pro include (public)" })
    .handler(({ context }) => billing.publicPricing(context.billing, context.ai?.dailyCap ?? 0)),
  status: authedProcedure
    .route({ method: "GET", path: "/billing", tags, summary: "The signed-in user's plan, Joyo Pro status, and usage against the limits" })
    .handler(({ context }) => billing.billingStatus(context.db, context.principal, context.billing, context.ai?.dailyCap ?? 0)),
};
