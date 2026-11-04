import { memo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Money, Pill, PickerButton, Text } from "@/components/ui";
import type { Tx } from "@/src/lib/tx-cache";

export type { Tx };

/** One transaction in a list: merchant, account and the bank's description, the amount, and a category chip. */
export const TransactionRow = memo(function TransactionRow({ t, onPress, onCategory }: { t: Tx; onPress: (t: Tx) => void; onCategory: (t: Tx) => void }) {
  const { theme } = useUnistyles();
  const title = t.merchant ?? t.description;
  return (
    <Pressable
      onPress={() => onPress(t)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${t.display}, ${t.account}${t.status === "pending" ? ", pending" : ""}, ${t.categoryName ?? "uncategorized"}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.muted }]}
    >
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {t.status === "pending" ? <Pill tone="warning" label="pending" /> : null}
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {t.account} · {t.description}
          </Text>
        </View>
        <Money amount={t.amount} display={t.display} currency={t.currency} signed variant="label" />
      </View>
      <PickerButton compact label="Category" text={t.categoryName ?? "Uncategorized"} muted={!t.category} onPress={() => onCategory(t)} />
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: { paddingHorizontal: theme.spacing.lg, paddingVertical: 12, gap: 8, backgroundColor: theme.colors.card },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontFamily: theme.fonts.medium, flexShrink: 1 },
}));
