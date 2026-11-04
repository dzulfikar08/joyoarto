// Personal API tokens (web: routes/settings.tsx): create one (copy it now, it is shown once), list, revoke. Only a
// Google/Apple sign-in can manage tokens; the demo account's tokens last a day.

import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert } from "react-native";

import { useMe } from "@/components/data";
import { SessionOnlyNote, useHasSession } from "@/components/session-only";
import { Button, Card, Divider, Field, Icon, ListRow, Row, SwitchRow, Text } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { shortDate } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { queryClient } from "@/src/lib/query";
import { toast } from "@/src/lib/toast";

const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.tokens.key() });

export function ApiTokens() {
  const hasSession = useHasSession();
  const me = useMe();
  const demo = !!me?.demo;
  const tokens = useQuery({ ...orpc.tokens.list.queryOptions(), enabled: hasSession });
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      client.tokens.create({ name: name.trim(), scopes: readOnly ? ["finance:read"] : ["finance:read", "finance:write"], ...(demo ? { expiresInDays: 1 } : {}) }),
    onSuccess: (r) => {
      setName("");
      setShown(r.token);
      toast.success("Token created", "Copy it now; it is not shown again.");
      void refresh();
    },
    onError: (e) => toast.error("Couldn't create the token", errorMessage(e, { storeSafe })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.tokens.revoke({ id }),
    onSuccess: () => {
      toast.success("Token revoked");
      void refresh();
    },
    onError: (e) => toast.error("Couldn't revoke the token", errorMessage(e, { storeSafe })),
  });

  const copy = (text: string) =>
    void Clipboard.setStringAsync(text).then(
      () => toast.success("Token copied"),
      () => toast.error("Couldn't copy"),
    );

  return (
    <Card title="API tokens" subtitle="For Claude Code, scripts and Shortcuts. A token acts as you.">
      {!hasSession ? (
        <SessionOnlyNote />
      ) : (
        <>
          {shown ? (
            <Card tone="warning">
              <Row style={{ alignItems: "flex-start" }}>
                <Icon name="key-outline" tone="warning" />
                <Text variant="caption" style={{ flex: 1 }}>Copy it now; it is not shown again.</Text>
              </Row>
              <Text selectable variant="label">{shown}</Text>
              <Row>
                <Button title="Copy token" icon="copy-outline" small flex onPress={() => copy(shown)} />
                <Button title="Done" variant="ghost" small onPress={() => setShown(null)} />
              </Row>
            </Card>
          ) : null}
          <Field label="Token name" placeholder="e.g. Claude Code laptop" maxLength={60} value={name} onChangeText={setName} />
          <SwitchRow label="Read-only" hint="Can look, cannot change anything." value={readOnly} onValueChange={setReadOnly} />
          {demo ? <Text variant="caption" tone="muted">Demo account: tokens last one day.</Text> : null}
          <Button title="Create token" icon="add" loading={create.isPending} disabled={!name.trim()} onPress={() => create.mutate()} />
          {tokens.isError ? <Text variant="caption" tone="destructive">{errorMessage(tokens.error, { storeSafe })}</Text> : null}
          {tokens.data && !tokens.data.tokens.length ? <Text variant="caption" tone="muted">No tokens yet.</Text> : null}
          {tokens.data?.tokens.length ? <Divider /> : null}
          {tokens.data?.tokens.map((t) => (
            <ListRow
              key={t.id}
              title={t.name}
              subtitle={[`${t.prefix}…`, t.scopes.includes("finance:write") ? "read and write" : "read-only", t.lastUsedAt ? `used ${shortDate(t.lastUsedAt)}` : "never used", t.expiresAt ? `expires ${shortDate(t.expiresAt)}` : null]
                .filter(Boolean)
                .join(" · ")}
              numberOfLines={2}
              right={
                <Button
                  title="Revoke"
                  variant="ghost"
                  small
                  accessibilityLabel={`Revoke ${t.name}`}
                  disabled={revoke.isPending}
                  onPress={() =>
                    Alert.alert(`Revoke "${t.name}"?`, "Anything using it stops working.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Revoke", style: "destructive", onPress: () => revoke.mutate(t.id) },
                    ])
                  }
                />
              }
            />
          ))}
        </>
      )}
    </Card>
  );
}
