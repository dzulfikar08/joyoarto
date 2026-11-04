// Polar (polar.sh, merchant of record): USD subscriptions for JoyoArto Pro, for cards from abroad. Checkout session and
// customer portal over the REST API, and Standard Webhooks signature verification. No SDK: three calls and one HMAC.
// Ported from JoyoRogo (packages/api/src/lib/polar.ts); the customer here is the household, not the user.

import type { BillingInterval } from "@baroka/db/schema/billing";

export const POLAR_WEBHOOK_PATH = "/api/billing/polar/webhook";
export const POLAR_PRODUCTION_URL = "https://api.polar.sh";
export const POLAR_SANDBOX_URL = "https://sandbox-api.polar.sh";
/** Standard Webhooks: reject deliveries whose timestamp is further than this from now. */
const TOLERANCE_MS = 5 * 60 * 1000;

export type PolarConfig = {
  accessToken: string;
  webhookSecret: string;
  baseUrl: string;
  productIds: Record<BillingInterval, string>;
  /** Displayed prices in US cents. The charge is the Polar product's own price: keep them equal. */
  priceUsdCents: Record<BillingInterval, number>;
};

/** Which plan a Polar product sells; null = not a JoyoArto Pro product (the organization may sell other apps). */
export function polarProductInterval(config: Pick<PolarConfig, "productIds">, productId: string | null | undefined): BillingInterval | null {
  if (!productId) return null;
  if (productId === config.productIds.monthly) return "monthly";
  if (productId === config.productIds.yearly) return "yearly";
  return null;
}

/** Id of a Polar order in billing_order. */
export function polarOrderId(orderId: string): string {
  return `polar:${orderId}`;
}

// ---- Standard Webhooks ------------------------------------------------------

const enc = new TextEncoder();

function b64decode(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * HMAC keys a `whsec_...` secret may mean. Standard Webhooks keys the HMAC with the base64-decoded part after the
 * prefix; older Polar secrets key it with the UTF-8 bytes of the whole string. Both are tried.
 */
function candidateKeys(secret: string): Uint8Array<ArrayBuffer>[] {
  const keys: Uint8Array<ArrayBuffer>[] = [];
  const decoded = b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (decoded && decoded.length > 0) keys.push(decoded);
  keys.push(enc.encode(secret));
  return keys;
}

export type WebhookHeaders = { id: string; timestamp: string; signature: string };

/**
 * Verifies a Standard Webhooks delivery over the raw body. `webhook-signature` holds space-separated "v1,<base64>"
 * entries; any one matching under any candidate key passes. crypto.subtle.verify compares in constant time.
 */
export async function verifyPolarWebhook(rawBody: string, headers: WebhookHeaders, secret: string, now = Date.now()): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const seconds = Number(headers.timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > TOLERANCE_MS) return false;

  const signed = enc.encode(`${headers.id}.${headers.timestamp}.${rawBody}`);
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const entry of headers.signature.split(" ")) {
    const [version, value] = entry.split(",");
    const bytes = version === "v1" && value ? b64decode(value) : null;
    if (bytes) signatures.push(bytes);
  }
  if (signatures.length === 0) return false;

  for (const raw of candidateKeys(secret)) {
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const signature of signatures) {
      if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
    }
  }
  return false;
}

/** Signs a delivery the way Polar does (tests, and local replays). `secret` is used as raw UTF-8 bytes unless it is whsec_<base64>. */
export async function signPolarWebhook(rawBody: string, id: string, timestamp: string, secret: string): Promise<string> {
  const keyBytes = candidateKeys(secret)[0]!;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${rawBody}`)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return `v1,${btoa(bin)}`;
}

// ---- REST API ---------------------------------------------------------------

export class PolarApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`polar ${path} failed: HTTP ${status} ${detail}`);
  }
}

async function call<T>(config: PolarConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PolarApiError(path, res.status, text.slice(0, 300));
  return JSON.parse(text) as T;
}

/**
 * Hosted checkout for one Pro plan. `external_customer_id` is the household id, so every later event and the customer
 * portal find the household without a lookup, whichever member opens it.
 */
export async function createPolarCheckout(
  config: PolarConfig,
  params: { interval: BillingInterval; householdId: string; userId: string; email: string; name: string; successUrl: string; returnUrl: string; customerIp?: string | null },
): Promise<{ url: string }> {
  const checkout = await call<{ url?: unknown }>(config, "/v1/checkouts/", {
    products: [config.productIds[params.interval]],
    external_customer_id: params.householdId,
    customer_email: params.email,
    customer_name: params.name,
    success_url: params.successUrl,
    return_url: params.returnUrl,
    ...(params.customerIp ? { customer_ip_address: params.customerIp } : {}),
    metadata: { app: "joyoarto", household_id: params.householdId, user_id: params.userId, interval: params.interval },
  });
  if (typeof checkout.url !== "string") throw new Error("polar checkout answered without a url");
  return { url: checkout.url };
}

/** Short-lived customer portal link (cancel, change plan, payment method, invoices). */
export async function createPolarPortal(config: PolarConfig, params: { householdId: string; returnUrl: string }): Promise<{ url: string }> {
  const session = await call<{ customer_portal_url?: unknown }>(config, "/v1/customer-sessions/", {
    external_customer_id: params.householdId,
    return_url: params.returnUrl,
  });
  if (typeof session.customer_portal_url !== "string") throw new Error("polar portal session answered without a url");
  return { url: session.customer_portal_url };
}
