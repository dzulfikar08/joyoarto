// Money flow band chart (the web's components/money-flow.tsx): money in on the left, spending groups and "Saved" in the
// middle, each group's subcategories on the right. Layout and colour order: @baroka/api/lib/flow.

import { fitLabel, flowColorSlots, flowColumns, flowOpens, flowPct, layoutFlow } from "@baroka/api/lib/flow";
import type { PlacedNode } from "@baroka/api/lib/flow";
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText, TSpan } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

import { compactMoney } from "@/src/lib/format";
import type { AppRouterClient, Out } from "@/src/lib/rpc";

export type MoneyFlow = Out<AppRouterClient["reports"]["flow"]>;
export type FlowUnit = "amount" | "pct";

const TOP = 40;

/** Colour per group id from the theme's chart series; saved is green, "everything else" grey. */
export function useFlowColors(flow: Pick<MoneyFlow, "nodes">) {
  const { theme } = useUnistyles();
  return useMemo(
    () =>
      new Map(
        [...flowColorSlots(flow.nodes, theme.viz.series.length)].map(([id, slot]) => [
          id,
          slot === "saved" ? theme.colors.positive : slot === null ? theme.viz.previous : theme.viz.series[slot]!,
        ]),
      ),
    [flow, theme],
  );
}

export function MoneyFlowChart({
  flow,
  unit = "amount",
  height = 380,
  onOpen,
}: {
  flow: MoneyFlow;
  unit?: FlowUnit;
  height?: number;
  /** Tapped group or category (with a slug, or null for uncategorised). Omit for a chart that does nothing on tap. */
  onOpen?: (node: PlacedNode) => void;
}) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const colors = useFlowColors(flow);
  const total = flow.nodes.find((n) => n.kind === "hub")?.amount ?? 0;

  const geo = useMemo(() => {
    if (!width) return null;
    const g = flowColumns(width, { sources: false });
    return { ...g, ...layoutFlow(flow, { columns: g.columns, first: g.first, height, nodeWidth: g.nodeWidth }) };
  }, [flow, width, height]);

  const value = (n: { amount: number }) => (unit === "pct" ? flowPct(n.amount, total) : compactMoney(n.amount, flow.currency));
  const colorOf = (group: string | null) => (group ? (colors.get(group) ?? theme.viz.previous) : theme.viz.muted);
  const dim = (group: string | null) => active !== null && group !== active;
  const summary = `Money flow: ${flow.income.display} in, ${flow.spending.display} spent${flow.saved.amount > 0 ? `, ${flow.saved.display} saved` : ""}${flow.fromSavings.amount > 0 ? `, ${flow.fromSavings.display} from savings` : ""}. ${flow.nodes
    .filter((n) => n.kind === "group" || n.kind === "saved")
    .map((n) => `${n.label} ${flowPct(n.amount, total)}`)
    .join(", ")}.`;

  const tap = (n: PlacedNode) => {
    // First tap highlights a group's bands; a second tap (or a tap on a highlighted category) opens its transactions.
    if (n.group && active !== n.group) return setActive(n.group);
    if (onOpen && flowOpens(n)) onOpen(n);
    else setActive(null);
  };

  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} accessible accessibilityRole="image" accessibilityLabel={summary}>
      {geo ? (
        <Svg width={width} height={geo.height + TOP + 4}>
          <G transform={`translate(0 ${TOP})`}>
            {geo.links.map((l) => (
              <Path key={`${l.source}>${l.target}`} d={l.path} fill={colorOf(l.group)} opacity={l.group ? (dim(l.group) ? 0.08 : active ? 0.5 : 0.28) : 0.16} onPress={() => setActive(l.group === active ? null : l.group)} />
            ))}
            {geo.nodes.map((n) => {
              const label = n.kind === "hub" ? null : n.kind === "item" ? { x: n.x + geo.nodeWidth + 7, anchor: "start" as const, px: geo.labels.item } : { x: n.x - 7, anchor: "end" as const, px: geo.labels.group };
              return (
                <G key={n.id} opacity={dim(n.group) && n.kind !== "hub" ? 0.35 : 1} onPress={() => tap(n)}>
                  {/* A wider transparent target than the bar itself. */}
                  {label ? <Rect x={label.anchor === "end" ? label.x - label.px : n.x} y={n.y + n.h / 2 - 15} width={label.px + geo.nodeWidth + 7} height={30} fill="transparent" /> : null}
                  <Rect x={n.x} y={n.y} width={geo.nodeWidth} height={n.h} rx={2.5} fill={n.kind === "hub" ? theme.viz.muted : colorOf(n.group)} />
                  {label ? (
                    <SvgText x={label.x} y={n.y + n.h / 2} textAnchor={label.anchor}>
                      <TSpan x={label.x} dy={-2} fontSize={12} fontFamily={theme.fonts.medium} fill={theme.colors.foreground}>
                        {fitLabel(n.label, label.px, 6.4)}
                      </TSpan>
                      <TSpan x={label.x} dy={14} fontSize={11} fontFamily={theme.numFonts.regular} fill={theme.colors.mutedForeground}>
                        {value(n)}
                      </TSpan>
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
            <SvgText x={0} y={-22}>
              <TSpan x={0} fontSize={12} fontFamily={theme.fonts.medium} fill={theme.colors.foreground}>
                {flow.fromSavings.amount > 0 ? "Income + savings" : "Money in"}
              </TSpan>
              <TSpan x={0} dy={15} fontSize={11} fontFamily={theme.numFonts.regular} fill={theme.colors.mutedForeground}>
                {unit === "pct" ? "100%" : compactMoney(total, flow.currency)}
              </TSpan>
            </SvgText>
          </G>
        </Svg>
      ) : (
        <View style={{ height: height + TOP }} />
      )}
    </View>
  );
}
