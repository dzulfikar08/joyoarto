// Liquid money month by month, one line per scenario (the web's ProjectionChart). "No change" is dashed in the
// previous-period colour. Tap the chart to read a month's values.

import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { compactMoney, formatMoney, monthLabel } from "@/src/lib/format";
import { tickMonths } from "@/src/lib/plan-state";

export type ProjectionSeries = { key: string; label: string; slot: number | null; values: number[] };

const HEIGHT = 200;
const AXIS_W = 48;
const LABEL_H = 20;
const PAD_TOP = 8;

const short = (m: string) => `${monthLabel(m, "short")} '${m.slice(2, 4)}`;

function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

export function ProjectionChart({ months, series }: { months: string[]; series: ProjectionSeries[] }) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const colorOf = (s: ProjectionSeries) => (s.slot === null ? theme.viz.previous : (theme.viz.series[(s.slot - 1) % theme.viz.series.length] ?? theme.viz.previous));

  const { min, max, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    let lo = Math.min(0, ...all);
    let hi = Math.max(1, ...all);
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const t: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) t.push(v);
    return { min: lo, max: hi, ticks: t };
  }, [series]);

  const plotW = Math.max(0, width - AXIS_W - 8);
  const plotH = HEIGHT - LABEL_H - PAD_TOP;
  const x = (i: number) => AXIS_W + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => PAD_TOP + plotH - ((v - min) / (max - min || 1)) * plotH;
  const shownTicks = new Set(tickMonths(months, Math.max(2, Math.floor(plotW / 64))));

  const summary = series.map((s) => `${s.label}: ends at ${formatMoney(s.values.at(-1) ?? 0)}, lowest ${formatMoney(Math.min(...s.values))}`).join("; ");

  const pick = (px: number) => {
    if (!months.length || plotW <= 0) return;
    const i = Math.round(((px - AXIS_W) / plotW) * (months.length - 1));
    setActive(Math.min(months.length - 1, Math.max(0, i)));
  };

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => pick(e.nativeEvent.locationX)}
        style={{ height: HEIGHT }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Liquid money over ${months.length} months. ${summary}`}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {ticks.map((t) => (
              <G key={t}>
                <Line x1={AXIS_W} x2={width - 8} y1={y(t)} y2={y(t)} stroke={t === 0 && min < 0 ? theme.viz.axis : theme.viz.grid} strokeWidth={1} />
                <SvgText x={AXIS_W - 6} y={y(t) + 4} fontSize={10} fill={theme.viz.muted} textAnchor="end">
                  {compactMoney(t)}
                </SvgText>
              </G>
            ))}
            {months.map((m, i) =>
              shownTicks.has(m) ? (
                <SvgText key={m} x={x(i)} y={HEIGHT - 4} fontSize={10} fill={theme.viz.muted} textAnchor="middle">
                  {short(m)}
                </SvgText>
              ) : null,
            )}
            {active !== null ? <Line x1={x(active)} x2={x(active)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke={theme.viz.axis} strokeWidth={1} /> : null}
            {series.map((s) => {
              const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
              return <Path key={s.key} d={d} stroke={colorOf(s)} strokeWidth={s.slot === null ? 1.5 : 2.25} strokeDasharray={s.slot === null ? "5 4" : undefined} fill="none" />;
            })}
            {active !== null
              ? series.map((s) => (s.values[active] !== undefined ? <Circle key={s.key} cx={x(active)} cy={y(s.values[active]!)} r={3.5} fill={colorOf(s)} /> : null))
              : null}
          </Svg>
        ) : null}
      </Pressable>
      {active !== null && months[active] ? (
        <View style={{ gap: 2 }} accessibilityLiveRegion="polite">
          <Text variant="caption" tone="muted">
            {monthLabel(months[active]!)}
          </Text>
          {series.map((s) => (
            <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: colorOf(s) }} />
              <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {s.label}
              </Text>
              <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
                {formatMoney(s.values[active] ?? 0)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          Tap the chart to read a month.
        </Text>
      )}
    </View>
  );
}

/** The key for a line: a short bar in its colour, dashed for "No change". */
export function LineKey({ slot }: { slot: number | null }) {
  const { theme } = useUnistyles();
  const color = slot === null ? theme.viz.previous : (theme.viz.series[(slot - 1) % theme.viz.series.length] ?? theme.viz.previous);
  return slot === null ? (
    <View style={{ flexDirection: "row", gap: 2 }}>
      <View style={{ width: 5, height: 3, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: 5, height: 3, backgroundColor: color, borderRadius: 1 }} />
    </View>
  ) : (
    <View style={{ width: 12, height: 3, backgroundColor: color, borderRadius: 2 }} />
  );
}
