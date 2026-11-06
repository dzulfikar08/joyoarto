// The MCP server for one request (apps/server/src/mcp.ts authenticates and calls this). No Worker bindings here, so
// tests can drive it with the SDK's in-memory client.

import type { Context as ApiContext, Principal } from "@baroka/api/context";
import type { BillingConfig } from "@baroka/api/lib/billing/config";
import { sealText } from "@baroka/api/lib/data-key";
import { pruneMcpAudit } from "@baroka/api/services/account";
import { mcpInstructions, toolInput, toolsForScopes } from "@baroka/api/tools";
import { schema } from "@baroka/db";
import type { Database } from "@baroka/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ORPCError, call } from "@orpc/server";

import type { RateLimit } from "./env";

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

export type McpServerOptions = {
  db: Database;
  billing?: BillingConfig;
  principal: Principal;
  /** OAuth client id, or "api-token". */
  clientId: string;
  waitUntil: (p: Promise<unknown>) => void;
  /** False on the Free plan: every tool answers with the upgrade message. */
  connectorAllowed: boolean;
  limiter?: RateLimit;
};

/** One request's MCP server: the tools this principal's scopes allow, run under its own context. */
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

export function createMcpServer({ db, billing, principal, clientId, waitUntil, connectorAllowed, limiter }: McpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: mcpInstructions(principal.scopes) });
  const context: ApiContext = { db, principal, ...(billing ? { billing } : {}) };

  // Only the tools this connection's scopes allow are listed: a read-only connection never sees a write tool.
  for (const def of toolsForScopes(principal.scopes)) {
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
            // Arguments only (ids, dates, filters); import rows are summarised, never stored.
            // A notification body (rawText) is read once and never kept, not even here. Sealed at rest (DATA_KEY):
            // search text and quick-add descriptions are member data.
            sealText(JSON.stringify(args, (k, v) => (k === "rows" && Array.isArray(v) ? `[${v.length} rows]` : k === "rawText" ? "[omitted]" : v)).slice(0, 500))
              .then((sealedArgs) =>
                db.insert(schema.mcpAudit).values({
                  id: crypto.randomUUID(),
                  userId: principal.userId,
                  clientId,
                  tool: def.name,
                  args: sealedArgs,
                  outcome,
                  ms: Date.now() - started,
                  createdAt: started,
                }),
              )
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
        if (limiter) {
          const { success } = await limiter.limit({ key: `mcp:${principal.userId}` });
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
