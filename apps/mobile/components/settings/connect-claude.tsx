// Connect Claude (web: routes/settings.tsx): the MCP URL for claude.ai / Claude Desktop, and the Claude Code command.

import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";

import { Button, Card, Row, Text } from "@/components/ui";
import { useSession } from "@/src/lib/auth";
import { proOnlyNote } from "@/src/lib/billing";
import { orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

export function ConnectClaude() {
  const session = useSession();
  const billing = useQuery(orpc.billing.status.queryOptions());
  if (!session) return null;
  const server = session.server.replace(/\/+$/, "");
  const mcpUrl = `${server}/mcp`;
  const command = `claude mcp add --transport http joyoarto ${mcpUrl} \\\n  --header "Authorization: Bearer brk_..."`;
  const copy = (text: string, what: string) =>
    void Clipboard.setStringAsync(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Couldn't copy"),
    );

  return (
    <Card title="Connect Claude" subtitle="Ask Claude about your money, import statements by chat">
      {billing.data && !billing.data.limits.mcpConnector ? <Text variant="caption" tone="warning">{proOnlyNote("Making changes from Claude", { storeSafe }) + " On this plan Claude can read and answer."}</Text> : null}
      <Text>
        <Text variant="label">claude.ai / Claude Desktop: </Text>
        Settings → Connectors → Add custom connector, with this URL. You sign in and approve there.
      </Text>
      <Row>
        <Text selectable variant="caption" tone="muted" style={{ flex: 1 }}>{mcpUrl}</Text>
        <Button title="Copy URL" icon="copy-outline" variant="secondary" small onPress={() => copy(mcpUrl, "URL")} />
      </Row>
      <Text>
        <Text variant="label">Claude Code: </Text>
        create an API token below, then run:
      </Text>
      <Text selectable variant="caption" tone="muted">{command}</Text>
      <Button title="Copy command" icon="copy-outline" variant="ghost" small onPress={() => copy(command, "Command")} />
      <Text variant="caption" tone="muted">REST API: {server}/api/docs, with the same token.</Text>
    </Card>
  );
}
