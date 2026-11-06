// Data & privacy: download your data (JSON or CSV, through the share sheet), connected AI apps, delete the household,
// delete the account. Same safeguards as the web (apps/web/src/routes/-data-privacy.tsx): a preview of which
// households go with the account, owners blocking it, and the email or household name typed to confirm. All of it
// needs a Google/Apple sign-in; the demo account is refused by the server.

import { useMutation, useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";

import { useMe } from "@/components/data";
import { SessionOnlyNote, useHasSession } from "@/components/session-only";
import { Button, Card, Disclosure, Field, ListRow, ListSection, Row, Screen, SkeletonCard, Text } from "@/components/ui";
import { signOut, useSession } from "@/src/lib/auth";
import { downloadError, emailConfirmed, EXPORTS, exportFileName, exportUrl, nameConfirmed, type ExportKind } from "@/src/lib/data-privacy";
import { errorMessage } from "@/src/lib/errors";
import { shortDate } from "@/src/lib/format";
import { signOutOfGoogle } from "@/src/lib/google-native-device";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { queryClient } from "@/src/lib/query";
import { toast } from "@/src/lib/toast";

export default function DataPrivacyScreen() {
  const hasSession = useHasSession();
  return (
    <Screen>
      {!hasSession ? (
        <Card>
          <SessionOnlyNote />
        </Card>
      ) : (
        <>
          <Download />
          <ConnectedApps />
          <DeleteHousehold />
          <DeleteAccount />
        </>
      )}
      <ListSection>
        <ListRow icon="shield-checkmark-outline" title="Privacy policy" onPress={() => void Linking.openURL("https://arto.joyorogo.com/privasi")} />
        <ListRow icon="document-outline" title="Terms" onPress={() => void Linking.openURL("https://arto.joyorogo.com/syarat")} />
      </ListSection>
    </Screen>
  );
}

function Download() {
  const session = useSession();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: ExportKind) {
    if (!session) return;
    setBusy(kind);
    setError(null);
    const dest = `${FileSystem.cacheDirectory}${exportFileName(kind)}`;
    try {
      let res: FileSystem.FileSystemDownloadResult;
      try {
        res = await FileSystem.downloadAsync(exportUrl(session.server, kind), dest, { headers: { Authorization: `Bearer ${session.token}` } });
      } catch {
        throw new Error(downloadError(0, ""));
      }
      if (res.status < 200 || res.status >= 300) {
        const body = await FileSystem.readAsStringAsync(dest).catch(() => "");
        void FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
        throw new Error(downloadError(res.status, body));
      }
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this phone.");
      await Sharing.shareAsync(res.uri, { mimeType: EXPORTS[kind].mimeType, UTI: EXPORTS[kind].uti, dialogTitle: EXPORTS[kind].label });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Download your data">
      <Text tone="muted">Everything as JSON, or just the transactions as CSV. You choose where it goes in the share sheet.</Text>
      <Disclosure plain title="What the JSON includes">
        Everything about you and the active household: profile, accounts, transactions, categories, rules, budgets, imports, saved plan scenarios, tokens, connected apps, AI activity log, your Joyo AI conversations and AI usage counts.
      </Disclosure>
      <Row>
        <Button title="All (JSON)" icon="download-outline" small flex loading={busy === "json"} disabled={!!busy} onPress={() => void run("json")} />
        <Button title="Transactions (CSV)" variant="secondary" small flex loading={busy === "csv"} disabled={!!busy} onPress={() => void run("csv")} />
      </Row>
      {error ? <Text variant="caption" tone="destructive">{error}</Text> : null}
    </Card>
  );
}

/** How much an AI app may do, from what the member approved. */
function accessLabel(a: { scopes: string[]; readOnly: boolean }): string {
  if (!a.scopes.some((s) => s.startsWith("finance:"))) return "no finance access";
  return a.readOnly ? "read-only" : "read and make changes";
}

function ConnectedApps() {
  const apps = useQuery(orpc.account.connections.queryOptions());
  const disconnect = useMutation({
    mutationFn: (clientId: string) => client.account.disconnect({ clientId }),
    onSuccess: () => {
      toast.success("Disconnected");
      void queryClient.invalidateQueries({ queryKey: orpc.account.connections.key() });
    },
    onError: (e) => toast.error("Couldn't disconnect", errorMessage(e, { storeSafe })),
  });
  const list = apps.data?.connections ?? [];
  return (
    <ListSection title="Connected AI apps" footer="API tokens (Claude Code, scripts) are under Settings → API tokens.">
      {apps.isPending ? (
        <ListRow title="Loading…" />
      ) : apps.isError ? (
        <ListRow icon="alert-circle-outline" iconTone="destructive" title="Couldn't load" subtitle={errorMessage(apps.error, { storeSafe })} onPress={() => void apps.refetch()} />
      ) : !list.length ? (
        <ListRow icon="sparkles-outline" iconTone="muted" title="No AI app is connected" />
      ) : (
        list.map((a) => (
          <ListRow
            key={a.clientId}
            title={a.name}
            subtitle={[accessLabel(a), `connected ${shortDate(a.connectedAt)}`].join(" · ")}
            numberOfLines={2}
            right={
              <Button
                title="Disconnect"
                variant="ghost"
                small
                disabled={disconnect.isPending}
                onPress={() =>
                  Alert.alert(`Disconnect ${a.name}?`, "It loses access to JoyoArto right away.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Disconnect", style: "destructive", onPress: () => disconnect.mutate(a.clientId) },
                  ])
                }
              />
            }
          />
        ))
      )}
    </ListSection>
  );
}

function DeleteHousehold() {
  const info = useQuery(orpc.household.get.queryOptions());
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => client.household.delete({ confirmName: typed }),
    onSuccess: (r) => {
      setOpen(false);
      setTyped("");
      toast.success(`Deleted ${r.name}`, `${r.transactionsDeleted} transactions.`);
      void queryClient.invalidateQueries();
    },
  });
  const h = info.data;
  if (!h) return null;
  const name = h.household.name;
  const others = h.members.length - 1;
  if (h.yourRole !== "owner") {
    return (
      <Card title="Household data">
        <Text tone="muted">Only an owner can delete {name}. You can leave it on the Household screen; its data stays with the other members.</Text>
      </Card>
    );
  }
  return (
    <Card title="Delete household data">
      {!open ? (
        <Button title={`Delete ${name}…`} variant="destructive" small onPress={() => setOpen(true)} />
      ) : (
        <>
          <Text>
            This permanently deletes {name} and everything in it: accounts, transactions, categories, rules, budgets, tags, imports and invites.
            {others > 0 ? ` ${others} other member${others > 1 ? "s" : ""} will lose access too.` : ""} It cannot be undone; download your data first if you want a copy.
          </Text>
          <Field label={`Type the household's name to confirm: ${name}`} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} autoComplete="off" />
          <Row>
            <Button title="Delete permanently" variant="destructive" small flex loading={del.isPending} disabled={!nameConfirmed(typed, name)} onPress={() => del.mutate()} />
            <Button title="Cancel" variant="ghost" small onPress={() => setOpen(false)} />
          </Row>
          {del.isError ? <Text variant="caption" tone="destructive">{errorMessage(del.error, { storeSafe })}</Text> : null}
        </>
      )}
    </Card>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const preview = useQuery({ ...orpc.account.deletionPreview.queryOptions(), enabled: open });
  const del = useMutation({
    mutationFn: () => client.account.delete({ confirmEmail: typed }),
    onSuccess: async () => {
      // The user and its sessions are gone: forget the session and everything cached on this phone.
      await signOut();
      void signOutOfGoogle();
      queryClient.clear();
      router.replace("/login");
      toast.success("Your account was deleted");
    },
  });
  const email = me?.user.email ?? "";
  const p = preview.data;
  const blocked = (p?.blocking.length ?? 0) > 0;

  return (
    <Card title="Delete my account">
      {!open ? (
        <Button title="Delete my account…" variant="destructive" small onPress={() => setOpen(true)} />
      ) : (
        <>
          <Text>Deletes your JoyoArto account, sign-in sessions, API tokens, AI connections and AI activity log, and signs you out. It cannot be undone.</Text>
          {preview.isPending ? <SkeletonCard lines={2} /> : null}
          {p ? (
            <View style={{ gap: 6 }}>
              {p.deleted.map((h) => (
                <Text key={h.id} variant="caption">• {h.name}: you are its only member, so it is deleted with all its data.</Text>
              ))}
              {p.left.map((h) => (
                <Text key={h.id} variant="caption">
                  • {h.name}: you leave it; its data stays with the other {h.members - 1} member{h.members > 2 ? "s" : ""}.
                </Text>
              ))}
              {p.blocking.map((h) => (
                <Text key={h.id} variant="caption" tone="destructive">
                  • {h.name}: you are its only owner and it has other members. Switch to it, make another member an owner (or delete the household), then come back.
                </Text>
              ))}
            </View>
          ) : null}
          {!blocked ? (
            <>
              <Field label={`Type your email to confirm: ${email}`} value={typed} onChangeText={setTyped} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" />
              <Row>
                <Button title="Delete permanently" variant="destructive" small flex loading={del.isPending} disabled={!p || !emailConfirmed(typed, email)} onPress={() => del.mutate()} />
                <Button title="Cancel" variant="ghost" small onPress={() => setOpen(false)} />
              </Row>
            </>
          ) : (
            <Button title="Close" variant="secondary" small onPress={() => setOpen(false)} />
          )}
          {del.error ?? preview.error ? <Text variant="caption" tone="destructive">{errorMessage(del.error ?? preview.error, { storeSafe })}</Text> : null}
        </>
      )}
    </Card>
  );
}
