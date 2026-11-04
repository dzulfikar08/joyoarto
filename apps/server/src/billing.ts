import { billingConfig } from "@baroka/api/lib/billing/config";
import type { BillingConfig } from "@baroka/api/lib/billing/config";

import { env } from "./env";

/**
 * Joyo Pro settings from wrangler vars and secrets. JoyoArto takes no payments and mounts no payment webhooks: Joyo Pro
 * is sold by JoyoRogo, and this server asks it for a user's status with JOYO_INTERNAL_KEY (unset = billing off).
 */
export const billing: BillingConfig = billingConfig(env);
