import { useState } from "react";
import { View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

export type PacePoint = { day: number; current: number | null; previous: number };

const HEIGHT = 120;

/** Running spending total by day of month: this month (solid) against last month (dashed). */
export function PaceChart({ points, label }: { points: PacePoint[]; label: string }) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...points.map((p) => Math.max(p.current ?? 0, p.previous)));
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * (width - 4) + 2 : 2);
  const y = (v: number) => 6 + (HEIGHT - 12) * (1 - v / max);
  const line = (vals: (number | null)[]) =>
    vals.reduce<string>((d, v, i) => (v === null ? d : `${d}${d ? " L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`), "");
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }} accessible accessibilityRole="image" accessibilityLabel={label}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={0} x2={width} y1={HEIGHT - 6} y2={HEIGHT - 6} stroke={theme.viz.axis} strokeWidth={1} />
          <Path d={line(points.map((p) => p.previous))} stroke={theme.viz.previous} strokeWidth={2} strokeDasharray="4 4" fill="none" />
          <Path d={line(points.map((p) => p.current))} stroke={theme.viz.series[0]} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}
