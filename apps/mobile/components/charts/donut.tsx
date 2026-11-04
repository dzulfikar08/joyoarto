import { Pressable, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { arcPath, donutAngles, type Slice } from "@/src/lib/dashboard";

/** A donut with the total in the middle. Tapping a slice selects it (the legend below does the same). */
export function DonutChart({ slices, size = 180, centerLabel, centerValue, active, onSelect, label }: { slices: Slice[]; size?: number; centerLabel: string; centerValue: string; active?: string | null; onSelect?: (key: string) => void; label: string }) {
  const { theme } = useUnistyles();
  const r = size / 2;
  const inner = r * 0.64;
  const angles = donutAngles(slices.map((s) => s.value));
  const color = (s: Slice) => (s.colorIndex === null ? theme.viz.previous : (theme.viz.series[s.colorIndex] ?? theme.viz.previous));
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size}>
        {slices.length === 0 ? <Circle cx={r} cy={r} r={(r + inner) / 2} stroke={theme.colors.muted} strokeWidth={r - inner} fill="none" /> : null}
        {slices.map((s, i) => {
          const a = angles[i];
          if (!a || a.a1 <= a.a0) return null;
          const dim = active && active !== s.key;
          return <Path key={s.key} d={arcPath(r, r, active === s.key ? r : r - 3, inner, a.a0, a.a1)} fill={color(s)} opacity={dim ? 0.35 : 1} onPress={onSelect ? () => onSelect(s.key) : undefined} />;
        })}
      </Svg>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <Text variant="caption" tone="muted">{centerLabel}</Text>
        <Text variant="label" numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: inner * 1.6, fontVariant: ["tabular-nums"] }}>
          {centerValue}
        </Text>
      </View>
    </View>
  );
}

/** A coloured square for legends. */
export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color }} />;
}

/** A legend row: swatch, label, value, and a second line (share, change). */
export function LegendRow({ color, label, value, detail, onPress, active }: { color: string | null; label: string; value: string; detail?: string; onPress?: () => void; active?: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} onPress={onPress} style={({ pressed }) => [styles.legend, (pressed || active) && { backgroundColor: theme.colors.muted }]}>
      <View style={styles.legendTop}>
        {color ? <Swatch color={color} /> : <View style={{ width: 10 }} />}
        <Text numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
      </View>
      {detail ? (
        <Text variant="caption" tone="muted" style={{ paddingLeft: 18, fontVariant: ["tabular-nums"] }}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create(() => ({
  center: { alignItems: "center", justifyContent: "center" },
  legend: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6, gap: 2 },
  legendTop: { flexDirection: "row", alignItems: "center", gap: 8 },
}));
