import { useState } from "react";
import { View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

import { compactMoney, niceTicks } from "@/src/lib/format";

export type CashflowMonth = { month: string; label: string; income: number; expense: number; incomeDisplay: string; expenseDisplay: string };

const HEIGHT = 170;
const AXIS_W = 44;
const LABEL_H = 22;

/** Income and spending per month as paired bars; tap a month to open it. */
export function CashflowChart({ months, selected, onSelect, currency = "IDR" }: { months: CashflowMonth[]; selected: string; onSelect?: (month: string) => void; currency?: string }) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, Math.abs(m.expense)]));
  const ticks = niceTicks(max, 3);
  const top = ticks.at(-1) ?? max;
  const plotH = HEIGHT - LABEL_H - 8;
  const plotW = Math.max(0, width - AXIS_W);
  const slot = months.length ? plotW / months.length : 0;
  const bar = Math.max(4, Math.min(16, slot * 0.28));
  const y = (v: number) => 8 + plotH - (Math.abs(v) / top) * plotH;
  const label = months.map((m) => `${m.label}: income ${m.incomeDisplay}, spending ${m.expenseDisplay}`).join("; ");
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }} accessible accessibilityRole="image" accessibilityLabel={`Cash flow. ${label}`}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {ticks.map((t) => (
            <G key={t}>
              <Line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} stroke={theme.viz.grid} strokeWidth={1} />
              <SvgText x={AXIS_W - 6} y={y(t) + 4} fontSize={10} fill={theme.viz.muted} textAnchor="end">
                {compactMoney(t, currency)}
              </SvgText>
            </G>
          ))}
          {months.map((m, i) => {
            const cx = AXIS_W + slot * i + slot / 2;
            const isSel = m.month === selected;
            return (
              <G key={m.month} onPress={onSelect ? () => onSelect(m.month) : undefined}>
                <Rect x={AXIS_W + slot * i + 2} y={4} width={slot - 4} height={HEIGHT - 4} rx={10} fill={isSel ? theme.colors.muted : "transparent"} />
                <Rect x={cx - bar - 1} y={y(m.income)} width={bar} height={Math.max(0, 8 + plotH - y(m.income))} rx={3} fill={theme.viz.series[0]} />
                <Rect x={cx + 1} y={y(m.expense)} width={bar} height={Math.max(0, 8 + plotH - y(m.expense))} rx={3} fill={theme.viz.series[1]} />
                <SvgText x={cx} y={HEIGHT - 6} fontSize={11} fill={isSel ? theme.colors.foreground : theme.viz.muted} fontWeight={isSel ? "700" : "400"} textAnchor="middle">
                  {m.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
