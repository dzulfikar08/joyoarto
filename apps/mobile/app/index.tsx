import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Platform, Pressable, View } from "react-native";

import { Button, Card, ErrorNote, Icon, Loading, Pill, Row, Screen, Text } from "@/components/ui";
import { isCaptureSupported, NotificationCapture } from "@/modules/notification-capture";
import { counts } from "@/src/capture/queue";
import { useCaptures } from "@/src/capture/store";
import { useApi, useSession } from "@/src/lib/auth";
import { useSettings } from "@/src/lib/settings";

export default function Home() {
  const api = useApi();
  const session = useSession();
  const router = useRouter();
  const settings = useSettings();
  const captures = useCaptures();
  const c = counts(captures);
  const dash = useQuery({ queryKey: ["dashboard", api.server], queryFn: () => api.dashboard() });
  const captureReady = isCaptureSupported && settings.captureEnabled && NotificationCapture.isPermissionGranted();
  const monthLabel = dash.data ? new Date(`${dash.data.month}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "";

  return (
    <Screen refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()}>
      <Stack.Screen
        options={{
          title: session?.me?.household.name ?? "JoyoArto",
          headerRight: () => (
            <Pressable onPress={() => router.push("/settings")} hitSlop={12} accessibilityLabel="Settings">
              <Icon name="settings-outline" size={22} />
            </Pressable>
          ),
        }}
      />
      {dash.isPending ? <Loading /> : dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
      {dash.data ? (
        <>
          <Card>
            <Text variant="label" tone="muted">{monthLabel}</Text>
            <Row gap={20} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" tone="muted">Money in</Text>
                <Text variant="heading" tone="positive">{dash.data.kpis.income.display}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" tone="muted">Money out</Text>
                <Text variant="heading">{dash.data.kpis.spending.display}</Text>
              </View>
            </Row>
            <Text variant="caption" tone="muted">Net {dash.data.kpis.net.display} · transfers between your own accounts are not counted</Text>
          </Card>

          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Text variant="heading">Balances</Text>
              <Text variant="label">{dash.data.accounts.total.display}</Text>
            </Row>
            {dash.data.accounts.groups.flatMap((g) => g.accounts).map((a) => (
              <Row key={a.id} style={{ justifyContent: "space-between", paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1}>{a.name}</Text>
                  {a.lastDate ? <Text variant="caption" tone="muted">Statement up to {a.lastDate}</Text> : null}
                </View>
                <Text variant="label" tone={a.balance.amount < 0 ? "destructive" : "default"}>{a.balance.display}</Text>
              </Row>
            ))}
            {dash.data.attention.pending ? (
              <Text variant="caption" tone="muted">Includes {dash.data.attention.pending} quick adds waiting for a statement.</Text>
            ) : null}
          </Card>
        </>
      ) : null}

      <Button title="Quick add" icon="add" onPress={() => router.push("/quick-add")} />

      {Platform.OS === "android" ? (
        <Card onPress={() => router.push(captureReady ? "/captured" : "/capture-setup")} tone={captureReady ? "default" : "primary"}>
          <Row style={{ justifyContent: "space-between" }}>
            <Row>
              <Icon name="notifications-outline" tone="primary" />
              <Text variant="heading">Captured</Text>
            </Row>
            <Icon name="chevron-forward" tone="muted" />
          </Row>
          {captureReady ? (
            <Row style={{ flexWrap: "wrap" }}>
              <Pill tone="positive" label={`${c.sent} sent`} />
              {c.review ? <Pill tone="warning" label={`${c.review} to check`} /> : null}
              {c.queued + c.sending ? <Pill tone="primary" label={`${c.queued + c.sending} waiting`} /> : null}
              {c.failed ? <Pill tone="destructive" label={`${c.failed} failed`} /> : null}
            </Row>
          ) : (
            <Text tone="muted">Turn on capture to save Jago and GoPay payments from their notifications.</Text>
          )}
        </Card>
      ) : null}

      <Card onPress={() => router.push("/import")}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row>
            <Icon name="document-text-outline" tone="primary" />
            <Text variant="heading">Import statements</Text>
          </Row>
          <Icon name="chevron-forward" tone="muted" />
        </Row>
        <Text tone="muted">Share a Jago or GoPay PDF to JoyoArto, or pick one here.</Text>
      </Card>
    </Screen>
  );
}
