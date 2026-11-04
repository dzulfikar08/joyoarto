import type { AiConfig, RequestInfo, ServerConfig } from "@baroka/api/context";
import { DEFAULT_CHAT_MODEL, DEFAULT_WORKERS_AI_MODEL } from "@baroka/api/lib/joyo-ai/chat";
import { capFrom } from "@baroka/api/lib/joyo-ai/limits";
import { appRouter } from "@baroka/api/routers/index";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { billing, registerBillingWebhooks } from "./billing";
import { handleEmail } from "./email";
import { env } from "./env";
import { registerMcpPublicCors, registerMcpRoutes } from "./mcp";
import { resolvePrincipal } from "./principal";
import { registerSeoRoutes } from "./seo";
import { getAuth, getDb } from "./services";

const app = new Hono();

app.use(logger());
registerSeoRoutes(app);
registerMcpPublicCors(app);
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

registerMcpRoutes(app);
registerBillingWebhooks(app);

app.on(["POST", "GET"], "/api/auth/*", (c) => getAuth().handler(c.req.raw));

/** Expected client errors (validation, not found) are answered, not logged as failures. */
function logError(error: unknown) {
  const status = (error as { status?: number }).status;
  if (!status || status >= 500) console.error(error);
}

const schemaConverters = [new ZodToJsonSchemaConverter()];

/** REST API with OpenAPI docs at /api/docs and the spec at /api/spec.json. */
const openApiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new SmartCoercionPlugin({ schemaConverters }),
    new OpenAPIReferencePlugin({
      schemaConverters,
      docsPath: "/docs",
      specPath: "/spec.json",
      docsTitle: "JoyoArto API",
      specGenerateOptions: {
        info: { title: "JoyoArto API", version: "0.1.0", description: "Send `Authorization: Bearer brk_...` (create a token in the web app) or use a browser session." },
        servers: [{ url: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api` }],
        components: { securitySchemes: { token: { type: "http", scheme: "bearer" } } },
        security: [{ token: [] }],
      },
    }),
  ],
  interceptors: [onError(logError)],
});

const adminEmails = (env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** What public endpoints need to know about the request (rate limit, hashed IP, operators). */
function requestInfo(request: Request): RequestInfo {
  const limiter = env.WAITLIST_LIMITER;
  return {
    ip: request.headers.get("CF-Connecting-IP"),
    ipSalt: env.BETTER_AUTH_SECRET,
    adminEmails,
    // Unbound in local dev: no limit.
    ...(limiter ? { allow: async (bucket: string, key: string) => (await limiter.limit({ key: `${bucket}:${key}` })).success } : {}),
  };
}

const serverConfig: ServerConfig = { importEmailDomain: env.IMPORT_EMAIL_DOMAIN?.trim().toLowerCase() || null };

const effort = env.JOYO_AI_EFFORT?.trim();

/** Joyo AI and voice capture. Secrets come from env only (wrangler secret put ANTHROPIC_API_KEY). */
function aiConfig(waitUntil: (p: Promise<unknown>) => void): AiConfig {
  return {
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicBaseUrl: (env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, ""),
    chatModel: env.JOYO_AI_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    parseModel: env.JOYO_PARSE_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    effort: effort === "low" || effort === "high" ? effort : "medium",
    workersAi: env.AI ?? null,
    workersAiModel: env.JOYO_WORKERS_AI_MODEL?.trim() || DEFAULT_WORKERS_AI_MODEL,
    dailyCap: capFrom(env.JOYO_AI_DAILY_CAP, 30),
    captureCap: capFrom(env.JOYO_CAPTURE_DAILY_CAP, 60),
    fakeTranscript: env.DEV_LOGIN === "1" || env.DEV_LOGIN === "true",
    waitUntil,
  };
}

/** Typed oRPC transport for the web app. */
const rpcHandler = new RPCHandler(appRouter, { interceptors: [onError(logError)] });

app.use("/*", async (c, next) => {
  const path = c.req.path;
  if (!path.startsWith("/rpc") && !path.startsWith("/api/")) return next();
  // The docs page and spec are public; everything else knows its caller.
  const isDocs = path === "/api/docs" || path === "/api/spec.json";
  const waitUntil = (p: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      void p;
    }
  };
  const context = { db: getDb(), principal: isDocs ? null : await resolvePrincipal(c.req.raw), request: requestInfo(c.req.raw), config: serverConfig, ai: aiConfig(waitUntil), billing };
  if (path.startsWith("/rpc")) {
    const { matched, response } = await rpcHandler.handle(c.req.raw, { prefix: "/rpc", context });
    if (matched) return c.newResponse(response.body, response);
  } else {
    const { matched, response } = await openApiHandler.handle(c.req.raw, { prefix: "/api", context });
    if (matched) return c.newResponse(response.body, response);
  }
  return next();
});

app.get("/", (c) => c.text("JoyoArto API. Docs: /api/docs, MCP: /mcp"));

// PWA share target (manifest.webmanifest). The web app's service worker normally answers it; without one (not
// installed yet, storage cleared) the shared files cannot be handed to the page, so the import page says so.
app.post("/share-target", (c) => c.redirect(`${(env.APP_URL ?? "").replace(/\/$/, "")}/import?shared=failed`, 303));

/** HTTP (Hono) and inbound email (Cloudflare Email Routing, see ./email.ts) on the same Worker. */
export default {
  fetch: app.fetch,
  email: (message: ForwardableEmailMessage) => handleEmail(message),
} satisfies ExportedHandler;
