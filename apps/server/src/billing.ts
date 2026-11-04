import { billingConfig } from "@baroka/api/lib/billing/config";
import type { BillingConfig } from "@baroka/api/lib/billing/config";
import { WEBHOOK_TARGET as DOKU_WEBHOOK_PATH } from "@baroka/api/lib/billing/doku";
import { POLAR_WEBHOOK_PATH } from "@baroka/api/lib/billing/polar";
import { handleDokuWebhook, handlePolarWebhook } from "@baroka/api/services/billing-webhooks";
import type { WebhookRequest } from "@baroka/api/services/billing-webhooks";
import type { Context, Hono } from "hono";

import { env } from "./env";
import { getDb } from "./services";

/** JoyoArto Pro settings from wrangler vars and secrets (DOKU defaults to its sandbox until DOKU_ENV=production). */
export const billing: BillingConfig = billingConfig(env, {
  appUrl: env.APP_URL || env.BETTER_AUTH_URL,
  apiUrl: env.BETTER_AUTH_URL,
});

async function webhookRequest(c: Context): Promise<WebhookRequest> {
  return { header: (name) => c.req.header(name), body: await c.req.text() };
}

/**
 * Payment webhooks, before the oRPC middleware (they read the raw body and need no session). Both paths are under
 * /api, which wrangler.jsonc already runs on the Worker first. Trust comes from the signatures only.
 */
export function registerBillingWebhooks(app: Hono) {
  app.post(DOKU_WEBHOOK_PATH, async (c) => {
    const res = await handleDokuWebhook(getDb(), billing, await webhookRequest(c));
    return c.json(res.body, res.status);
  });
  app.post(POLAR_WEBHOOK_PATH, async (c) => {
    const res = await handlePolarWebhook(getDb(), billing, await webhookRequest(c));
    return c.json(res.body, res.status);
  });
}
