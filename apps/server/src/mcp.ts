import type { Context as ApiContext, Principal, Scope } from "@baroka/api/context";
import { SCOPES } from "@baroka/api/context";
import { DEMO_TOKEN_DAYS, isDemoUser } from "@baroka/api/lib/demo";
import { ensureHousehold } from "@baroka/api/lib/household";
import { pruneMcpAudit } from "@baroka/api/services/account";
import { userPlan } from "@baroka/api/services/billing";
import { principalFromToken } from "@baroka/api/services/tokens";
import { MCP_INSTRUCTIONS, toolCatalog, toolInput } from "@baroka/api/tools";
import { MCP_DATA_SCOPES, MCP_PATH } from "@baroka/auth/mcp-scopes";
import { McpAuthError, verifyMcpAccessToken } from "@baroka/auth/mcp-token";
import { schema } from "@baroka/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ORPCError, call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";

import { isAnthropicEgress } from "./anthropic-egress";
import { billing } from "./billing";
import { env } from "./env";
import { getAuth, getDb } from "./services";


/** What MCP clients show for this server (serverInfo); the directory listing and docs page say the same. */
export const SERVER_INFO = {
  name: "joyoarto",
  title: "JoyoArto",
  version: "1.0.0",
  websiteUrl: "https://arto.joyorogo.com/claude",
  icons: [
    { src: "https://arto.joyorogo.com/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
    { src: "https://arto.joyorogo.com/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
  ],
};

function text(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function describeError(error: unknown): string {
  if (error instanceof ORPCError) {
    const issues = (error.data as { issues?: { path?: (string | number)[]; message: string }[] } | undefined)?.issues;
    if (issues?.length) return `${error.message}: ${issues.map((i) => `${(i.path ?? []).join(".") || "input"}: ${i.message}`).join("; ")}`;
    return error.message;
  }
  console.error("[mcp] tool failed", error);
  return "JoyoArto had an internal error; try again in a moment.";
}

/** What a Free household's connector answers to every tool call (tools stay listed, so Claude can explain it). */
const UPGRADE_MESSAGE =
  "The Claude connector is part of JoyoArto Pro, and this household is on the Free plan. Tell the user they can upgrade in JoyoArto (Settings → Billing, or /pricing); everything else in the app keeps working on Free.";

function createMcpServer(principal: Principal, clientId: string, waitUntil: (p: Promise<unknown>) => void, connectorAllowed: boolean): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
  const db = getDb();
  const context: ApiContext = { db, principal, billing };

  for (const def of toolCatalog()) {
    const input = toolInput(def);
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        ...(input ? { inputSchema: input.shape } : {}),
        annotations: {
          readOnlyHint: def.readOnly ?? false,
          // The MCP default for a write tool is destructive; read-only tools have no destructive hint to give.
          destructiveHint: def.readOnly ? false : (def.destructive ?? true),
          idempotentHint: Boolean(def.readOnly || def.idempotent),
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        const started = Date.now();
        const log = (outcome: string) =>
          waitUntil(
            db
              .insert(schema.mcpAudit)
              .values({
                id: crypto.randomUUID(),
                userId: principal.userId,
                clientId,
                tool: def.name,
                // Arguments only (ids, dates, filters); import rows are summarised, never stored.
                // A notification body (rawText) is read once and never kept, not even here.
                args: JSON.stringify(args, (k, v) => (k === "rows" && Array.isArray(v) ? `[${v.length} rows]` : k === "rawText" ? "[omitted]" : v)).slice(0, 500),
                outcome,
                ms: Date.now() - started,
                createdAt: started,
              })
              // Retention (privacy policy: 90 days). No cron trigger yet, so about one call in 50 prunes old rows.
              .then(() => (Math.random() < 0.02 ? pruneMcpAudit(db) : 0))
              .catch((e: unknown) => console.error("[mcp] audit failed", e)),
          );
        if (!connectorAllowed) {
          log("plan");
          return failure(UPGRADE_MESSAGE);
        }
        if (!principal.scopes.includes(def.scope)) {
          log("scope");
          return failure(`This connection lacks the "${def.scope}" permission. Reconnect JoyoArto and approve it.`);
        }
        if (env.MCP_LIMITER) {
          const { success } = await env.MCP_LIMITER.limit({ key: `mcp:${principal.userId}` });
          if (!success) return failure("Too many requests; wait a minute and try again.");
        }
        try {
          const callInput = { ...def.defaults, ...((args ?? {}) as Record<string, unknown>) };
          const result = await call(def.procedure() as Parameters<typeof call>[0], callInput as never, { context: context as never });
          log("ok");
          return text(result);
        } catch (error) {
          log("error");
          return failure(describeError(error));
        }
      },
    );
  }
  return server;
}

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
    // A JWT cannot be revoked, so the consent is checked on every request: removing a connection works at once.
    const [consent] = await db
      .select({ id: schema.oauthConsent.id, createdAt: schema.oauthConsent.createdAt, updatedAt: schema.oauthConsent.updatedAt })
      .from(schema.oauthConsent)
      .where(and(eq(schema.oauthConsent.userId, p.userId), eq(schema.oauthConsent.clientId, p.clientId)))
      .limit(1);
    if (!consent) return challenge(401, "revoked", "This connection was removed. Connect JoyoArto again.");
    // The demo account (store and connector-directory reviewers): its made-up data resets daily, and a connection to it
    // lasts DEMO_TOKEN_DAYS, like the phone app's demo token. The daily reset removes older demo consents too.
    if (isDemoUser(p.userId) && Date.now() - ((consent.updatedAt ?? consent.createdAt)?.getTime() ?? 0) > DEMO_TOKEN_DAYS * 86_400_000) {
      return challenge(401, "demo", `Demo connections last ${DEMO_TOKEN_DAYS} days. Connect JoyoArto again with the demo code.`);
    }
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
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    // claude.ai registers a client (DCR) for every new connection from Anthropic's few egress addresses, so a per-IP
    // limit there would be shared by every Claude user; each of those registrations follows a person's Connect click.
    if (env.OAUTH_REGISTER_LIMITER && c.req.method === "POST" && !isAnthropicEgress(ip)) {
      const { success } = await env.OAUTH_REGISTER_LIMITER.limit({ key: `register:${ip}` });
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
    const server = createMcpServer(auth.principal, auth.clientId, waitUntilOf(c), limits.mcpConnector);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
