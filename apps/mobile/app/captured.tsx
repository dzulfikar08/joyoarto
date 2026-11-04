import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Pill, Row, Segmented, Text } from "@/components/ui";
import { amountLabel, SOURCE, STATUS } from "@/src/capture/labels";
import { useCaptures } from "@/src/capture/store";
import { syncCaptures } from "@/src/capture/sync";

type Filter = "all" | "todo" | "sent" | "ignored";

export default function Captured() {
  const router = useRouter();
  const items = useCaptures();
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, setSyncing] = useState(false);
  const shown = [...items]
    .filter((i) => filter === "all" || (filter === "todo" ? ["review", "queued", "sending", "failed"].includes(i.status) : i.status === filter))
    .sort((a, b) => b.postedAt - a.postedAt);

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "todo", label: "To do" },
            { value: "sent", label: "Sent" },
            { value: "ignored", label: "Ignored" },
          ]}
        />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshing={syncing}
        onRefresh={() => {
          setSyncing(true);
          void syncCaptures().finally(() => setSyncing(false));
        }}
        ListEmptyComponent={
          <View style={{ padding: 24, gap: 12 }}>
            <Text tone="muted">Nothing here yet. Payments from the apps you allowed show up as their notifications arrive.</Text>
            <Button title="Capture settings" variant="secondary" onPress={() => router.push("/capture-setup")} />
          </View>
        }
        renderItem={({ item: i }) => (
          <Pressable onPress={() => router.push({ pathname: "/capture/[id]", params: { id: i.id } })} style={styles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="label" numberOfLines={1}>{i.edits.merchant ?? i.parsed?.counterparty ?? i.title}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {SOURCE[i.source]} · {new Date(i.postedAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {i.status === "ignored" && i.ignoredReason ? ` · ${i.ignoredReason}` : ""}
                {i.status === "failed" && i.lastError ? ` · ${i.lastError}` : ""}
                {i.simulated ? " · test" : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="label" tone={(i.edits.direction ?? i.parsed?.direction) === "in" ? "positive" : "default"}>{amountLabel(i)}</Text>
              <Row gap={4}>
                {i.parsed?.confidence === "low" && i.status !== "ignored" ? <Pill label="unsure" tone="warning" /> : null}
                <Pill label={STATUS[i.status].label} tone={STATUS[i.status].tone} />
              </Row>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  head: { padding: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  list: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxl, gap: theme.spacing.sm },
  row: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: theme.colors.card, borderRadius: theme.radius.tile, padding: theme.spacing.md },
}));
