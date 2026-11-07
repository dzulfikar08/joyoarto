import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, IconButton, Row, Text } from "@/components/ui";
import { monthLabel, shiftMonth } from "@/src/lib/format";

/** ‹ November 2026 › with a "This month" shortcut when another month is shown (Home, Money flow). */
export function MonthSwitcher({ month, thisMonth, onChange }: { month: string; thisMonth: string; onChange: (m: string) => void }) {
  return (
    <Row style={{ justifyContent: "space-between" }}>
      <View style={styles.switcher}>
        <IconButton name="chevron-back" label="Previous month" size={18} onPress={() => onChange(shiftMonth(month, -1))} />
        <Text variant="heading" style={{ minWidth: 140, textAlign: "center" }} accessibilityRole="header">
          {monthLabel(month)}
        </Text>
        <IconButton name="chevron-forward" label="Next month" size={18} tone={month >= thisMonth ? "muted" : "default"} onPress={() => month < thisMonth && onChange(shiftMonth(month, 1))} />
      </View>
      {month !== thisMonth ? <Button title="This month" variant="ghost" small onPress={() => onChange(thisMonth)} /> : null}
    </Row>
  );
}

const styles = StyleSheet.create((theme) => ({
  switcher: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill, paddingHorizontal: 2 },
}));
