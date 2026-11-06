import type { Principal, Scope } from "@baroka/api/context";
import { SCOPES } from "@baroka/api/context";
import { isDemoUser } from "@baroka/api/lib/demo";
import { ensureHousehold } from "@baroka/api/lib/household";
import { userPlan } from "@baroka/api/services/billing";
import { principalFromToken } from "@baroka/api/services/tokens";
import { MCP_DATA_SCOPES, MCP_PATH } from "@baroka/auth/mcp-scopes";
import { McpAuthError, verifyMcpAccessToken } from "@baroka/auth/mcp-token";
import { schema } from "@baroka/db";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";

import { billing } from "./billing";
import { env } from "./env";
import { createMcpServer } from "./mcp-server";
import { getAuth, getDb } from "./services";

function challenge(status: 401, code: string, description: string): Response {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const params = [`resource_metadata="${base}/.well-known/oauth-protected-resource${MCP_PATH}"`, `scope="${MCP_DATA_SCOPES.join(" ")}"`];
  if (code !== "missing_token") params.push('error="invalid_token"', `error_description="${description.replaceAll('"', "'")}"`);
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: description }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer ${params.join(", ")}`, "Cache-Control": "no-store" },
  });
}

/** An OAuth connection (claude.ai, Claude Desktop) or a personal access token (Claude Code: Authorization: Bearer brk_...). */
async function authenticate(request: Request): Promise<{ principal: Principal; clientId: string } | Response> {
  const db = getDb();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (bearer?.startsWith("brk_")) {
    const principal = await principalFromToken(db, bearer);
    if (!principal) return challenge(401, "invalid_token", "The API token is invalid, expired or revoked.");
    return { principal, clientId: "api-token" };
  }
  try {
    const p = await verifyMcpAccessToken(getAuth(), request, env.BETTER_AUTH_URL);
    // The demo account (store reviewers) cannot keep a connection alive past its daily reset.
    if (isDemoUser(p.userId)) return challenge(401, "demo", "The demo account cannot connect AI apps.");
    // A JWT cannot be revoked, so the consent is checked on every request: removing a connection works at once.
    const [consent] = await db
      .select({ id: schema.oauthConsent.id })
      .from(schema.oauthConsent)
      .where(and(eq(schema.oauthConsent.userId, p.userId), eq(schema.oauthConsent.clientId, p.clientId)))
      .limit(1);
    if (!consent) return challenge(401, "revoked", "This connection was removed. Connect JoyoArto again.");
    return {
      principal: {
        userId: p.userId,
        householdId: await ensureHousehold(db, p.userId),
        scopes: p.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)),
        via: "oauth",
        clientId: p.clientId,
      },
      clientId: p.clientId,
    };
  } catch (error) {
    if (error instanceof McpAuthError) return challenge(401, error.code, error.message);
    throw error;
  }
}

/** Open CORS (no cookies) for what browser-based MCP clients call; register before the credentialed CORS. */
export function registerMcpPublicCors(app: Hono) {
  const open = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Accept", "MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"],
    exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
    credentials: false,
    maxAge: 600,
  });
  for (const path of [MCP_PATH, "/.well-known/*", "/api/auth/oauth2/register", "/api/auth/oauth2/token", "/api/auth/oauth2/revoke", "/api/auth/jwks"]) {
    app.use(path, open);
  }
}

export function registerMcpRoutes(app: Hono) {
  const waitUntilOf = (c: Context) => (promise: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(promise);
    } catch {
      void promise;
    }
  };

  app.use("/api/auth/oauth2/register", async (c, next) => {
    if (env.OAUTH_REGISTER_LIMITER && c.req.method === "POST") {
      const { success } = await env.OAUTH_REGISTER_LIMITER.limit({ key: `register:${c.req.header("CF-Connecting-IP") ?? "unknown"}` });
      if (!success) return c.json({ error: "temporarily_unavailable", error_description: "Too many registrations; try again in a minute." }, 429);
    }
    await next();
  });

  // Discovery: RFC 9728 (resource) and RFC 8414 / OIDC (issuer at /api/auth) come from the auth handler; clients
  // that look for the issuer metadata at the origin root get the same document.
  app.on(["GET", "HEAD"], "/.well-known/*", async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
      url.pathname = `${url.pathname}/api/auth`;
      return getAuth().handler(new Request(url.toString(), c.req.raw));
    }
    return getAuth().handler(c.req.raw);
  });

  app.all(MCP_PATH, async (c) => {
    const auth = await authenticate(c.req.raw);
    if (auth instanceof Response) return auth;
    if (c.req.method !== "POST") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
      });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error." }, id: null }, 400);
    }
    const { limits } = await userPlan(getDb(), auth.principal.userId, billing);
    const server = createMcpServer({
      db: getDb(),
      billing,
      principal: auth.principal,
      clientId: auth.clientId,
      waitUntil: waitUntilOf(c),
      connectorAllowed: limits.mcpConnector,
      limiter: env.MCP_LIMITER,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
