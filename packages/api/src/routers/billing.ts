import { z } from "zod";

import { authedProcedure, publicProcedure } from "../index";
import * as billing from "../services/billing";

const tags = ["billing"];

/**
 * Joyo Pro, per account. JoyoRogo is the billing authority: on the web and Android Joyo Pro is bought and managed there
 * (`proUrl`); the iOS app sells it with In-App Purchase (its own App Store products), which this server hands to
 * JoyoRogo to credit (services/billing.ts). Prices are JoyoRogo's own, read from its public config.
 */
export const billingRouter = {
  pricing: publicProcedure
    .route({ method: "GET", path: "/billing/pricing", tags, summary: "Joyo Pro prices (JoyoRogo's), where to buy it, and what Free and Pro include (public)" })
    .handler(({ context }) => billing.publicPricing(context.billing, context.ai?.dailyCap ?? 0)),
  status: authedProcedure
    .route({ method: "GET", path: "/billing", tags, summary: "The signed-in user's plan, Joyo Pro status, and usage against the limits" })
    .handler(({ context }) => billing.billingStatus(context.db, context.principal, context.billing, context.ai?.dailyCap ?? 0)),
  appleAccountToken: authedProcedure
    .route({ method: "POST", path: "/billing/apple/token", tags, summary: "iOS: the appAccountToken to pass to StoreKit before buying Joyo Pro" })
    .handler(({ context }) => billing.appleAccountToken(context.db, context.principal, context.billing)),
  appleRedeem: authedProcedure
    .route({ method: "POST", path: "/billing/apple", tags, summary: "iOS: credit a StoreKit 2 transaction (purchase, restore) to the user's Joyo Pro" })
    .input(z.object({ signedTransaction: z.string().min(20).max(20_000) }))
    .handler(({ context, input }) => billing.redeemApplePurchase(context.db, context.principal, context.billing, input.signedTransaction)),
};
