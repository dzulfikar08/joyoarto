// OAuth scopes of the MCP connector. They mirror the API scopes (packages/api/src/context.ts).

export const MCP_DATA_SCOPES = ["finance:read", "finance:write"] as const;
export type McpDataScope = (typeof MCP_DATA_SCOPES)[number];

/** Lets the client refresh its access token without sending the user through consent again. */
export const MCP_OFFLINE_SCOPE = "offline_access";

export const MCP_SCOPES: readonly string[] = [...MCP_DATA_SCOPES, MCP_OFFLINE_SCOPE];

export function isMcpDataScope(scope: string): scope is McpDataScope {
  return (MCP_DATA_SCOPES as readonly string[]).includes(scope);
}

/** The path of the MCP endpoint below the API origin. */
export const MCP_PATH = "/mcp";
