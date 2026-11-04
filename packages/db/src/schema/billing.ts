import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { household } from "./finance";

// JoyoArto Pro is bought for a household: everyone in it shares the plan. Entitlements and orders are keyed by
// household, never by user alone (the buyer is recorded on the order for support, nothing more).
//
// Free, trial and grandfathered Pro need no rows: they follow from the household's age and the server's billing config
// (packages/api/src/lib/billing). A row here means a payment provider granted Pro.

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Who sold the Pro time. doku: IDR prepaid months (QRIS, e-wallets, VA). polar: USD subscription (cards abroad).
 * google_play / apple: reserved for the phone apps' store billing. manual: granted by the operator.
 */
export const BILLING_PROVIDERS = ["doku", "polar", "google_play", "apple", "manual"] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

/** active: paid and renewing (or prepaid). canceled: will not renew, Pro until period_end. past_due: renewal failed, short grace. expired: over. */
export const ENTITLEMENT_STATUSES = ["active", "canceled", "past_due", "expired"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * One row per household and provider, so prepaid DOKU months, a Polar subscription and (later) a Google Play
 * subscription can sit side by side; the household is Pro while any of them is live.
 */
export const householdEntitlement = sqliteTable(
  "household_entitlement",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: BILLING_PROVIDERS }).notNull(),
    plan: text("plan", { enum: ["pro"] }).notNull().default("pro"),
    status: text("status", { enum: ENTITLEMENT_STATUSES }).notNull(),
    interval: text("interval", { enum: BILLING_INTERVALS }),
    /** Pro lasts until here (prepaid months stack on it; a subscription sets it to the current period's end). */
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
    /** Provider's customer and subscription ids (Polar customer/subscription, Play purchase token, Apple original transaction). */
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    /** The provider's own modified time: an older webhook never overwrites a newer state. */
    providerModifiedAt: integer("provider_modified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.provider] }), index("household_entitlement_subscription_idx").on(t.providerSubscriptionId)],
);

export const ORDER_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Every checkout and payment. DOKU orders are created here before the buyer leaves for DOKU (id "ART-..."); the
 * webhook flips pending -> paid exactly once and only that flip extends the household's Pro time. Polar orders are
 * recorded when their webhook arrives (id "polar:<order id>"). Kept when the household is deleted (household_id is
 * cleared): payment records are bookkeeping the operator must keep.
 */
export const billingOrder = sqliteTable(
  "billing_order",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").references(() => household.id, { onDelete: "set null" }),
    /** The member who started the checkout (null for renewals and after the account is deleted). */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    provider: text("provider", { enum: BILLING_PROVIDERS }).notNull(),
    interval: text("interval", { enum: BILLING_INTERVALS }).notNull(),
    /** Pro months this order buys (12 = yearly); 0 for a charge that grants no time (a plan-change proration). */
    months: integer("months").notNull(),
    /** Minor units of `currency` (IDR exponent 2: Rp 29.000 = 2900000; USD cents). */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    /** standard or founder: the price the checkout used. */
    priceTier: text("price_tier", { enum: ["standard", "founder"] }).notNull().default("standard"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    paymentUrl: text("payment_url"),
    /** The provider's own id for this payment (Polar order id). */
    providerRef: text("provider_ref"),
    /** Pro end this order produced (set when it was paid). */
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    /** 1 = sandbox, not really charged. */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("billing_order_household_idx").on(t.householdId, t.createdAt), index("billing_order_status_idx").on(t.status, t.createdAt)],
);

/** Webhook deliveries already processed (Polar `webhook-id`), so a redelivery does nothing twice. */
export const billingEvent = sqliteTable(
  "billing_event",
  {
    provider: text("provider", { enum: BILLING_PROVIDERS }).notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

/** Metered plan limits per household and period (metric "statement_import", period "YYYY-MM" in WIB). */
export const usageCounter = sqliteTable(
  "usage_counter",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.metric, t.period] })],
);
