import { authedProcedure, publicProcedure, sessionProcedure } from "../index";
import * as billing from "../services/billing";

const tags = ["billing"];

/**
 * JoyoArto Pro for the household. Prices are public; buying and the portal need a browser session (a token or an AI
 * connection cannot spend money). Webhooks are plain routes in apps/server/src/billing.ts.
 */
export const billingRouter = {
  pricing: publicProcedure
    .route({ method: "GET", path: "/billing/pricing", tags, summary: "Prices and what Free and Pro include (public)" })
    .handler(({ context }) => billing.publicPricing(context.db, context.billing, context.ai?.dailyCap ?? 0)),
  status: authedProcedure
    .route({ method: "GET", path: "/billing", tags, summary: "The active household's plan, renewal, usage against the limits and recent orders" })
    .handler(({ context }) => billing.billingStatus(context.db, context.principal, context.billing, context.ai?.dailyCap ?? 0)),
  checkout: sessionProcedure
    .route({ method: "POST", path: "/billing/checkout", tags, summary: "Pay for Pro in rupiah (DOKU: QRIS, e-wallets, virtual accounts); returns the payment page URL" })
    .input(billing.checkoutInput)
    .handler(({ context, input }) => billing.startDokuCheckout(context.db, context.principal, context.billing, input)),
  polarCheckout: sessionProcedure
    .route({ method: "POST", path: "/billing/polar/checkout", tags, summary: "Subscribe to Pro in US dollars by card (Polar); returns the checkout URL" })
    .input(billing.checkoutInput)
    .handler(({ context, input }) => billing.startPolarCheckout(context.db, context.principal, context.billing, input, context.request?.ip)),
  portal: sessionProcedure
    .route({ method: "POST", path: "/billing/polar/portal", tags, summary: "Open the card subscription's portal (cancel, change plan, invoices)" })
    .handler(({ context }) => billing.polarPortal(context.db, context.principal, context.billing)),
  order: authedProcedure
    .route({ method: "GET", path: "/billing/orders/{id}", tags, summary: "One of the household's orders" })
    .input(billing.orderIdInput)
    .handler(({ context, input }) => billing.getOrder(context.db, context.principal, input.id)),
  checkOrder: sessionProcedure
    .route({ method: "POST", path: "/billing/orders/{id}/check", tags, summary: "Ask the payment provider whether a pending order was paid, and settle it" })
    .input(billing.orderIdInput)
    .handler(({ context, input }) => billing.checkOrder(context.db, context.principal, context.billing, input.id)),
};
