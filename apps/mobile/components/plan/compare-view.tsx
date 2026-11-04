// The results under the scenarios (the web's CompareView): liquid money over time, the scenarios side by side
// (swipe sideways), each verdict with its reasons and checks, and the assumptions.

import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Card, Icon, Text } from "@/components/ui";
import { monthLabel } from "@/src/lib/format";
import { plainVerdict, slotOf, type Scenario } from "@/src/lib/plan-state";

import { LineKey, ProjectionChart } from "./projection-chart";
import { VerdictBadge, type Compare, type CompareScenario } from "./scenario-card";

const STATUS = {
  ok: { icon: "checkmark" as const, tone: "positive" as const },
  warn: { icon: "alert" as const, tone: "warning" as const },
  fail: { icon: "close" as const, tone: "destructive" as const },
  info: { icon: "information" as const, tone: "muted" as const },
};

export function CompareView({ c, scenarios }: { c: Compare; scenarios: Scenario[] }) {
  const series = c.scenarios.map((s) => ({ key: s.name, label: s.name, slot: slotOf(s.name, scenarios), values: s.series.total }));
  const rows: { label: string; cell: (s: CompareScenario) => string }[] = [
    { label: "Verdict", cell: (s) => ({ comfortable: "✓ Comfortable", tight: "! Tight", risky: "✕ Risky" })[s.verdict] },
    { label: "New installments / month", cell: (s) => s.summary.installment.display },
    { label: "Cash out (DP, fees, one-offs)", cell: (s) => s.summary.upfront.display },
    { label: "Lowest liquid balance", cell: (s) => `${s.summary.lowestBalance.display} (${monthLabel(s.summary.lowestBalance.month, "short")} ${s.summary.lowestBalance.month.slice(2, 4)})` },
    { label: "Emergency fund covers (worst)", cell: (s) => `${s.summary.emergencyCoverMonths >= 999 ? "∞" : s.summary.emergencyCoverMonths} months` },
    { label: "Installments / income", cell: (s) => `${s.summary.debtRatioPct}%` },
    { label: "Car installment / income", cell: (s) => (s.summary.carInstallment.amount ? `${s.summary.carRatioPct}%` : "–") },
    { label: "Average free cash / month", cell: (s) => s.summary.averageFreeCash.display },
    { label: `Balance after ${c.horizonMonths} months`, cell: (s) => s.summary.endBalance.display },
    {
      label: "Goal savings rebuilt",
      cell: (s) => (s.summary.goalRebuiltInMonths === null ? "not in this period" : s.summary.goalRebuiltInMonths === 0 ? "not touched" : `after ${s.summary.goalRebuiltInMonths} months`),
    },
  ];
  return (
    <>
      <Card title="Liquid money over time" subtitle={`Emergency, goal and spending accounts together, ${monthLabel(c.startMonth, "short")} ${c.startMonth.slice(0, 4)} onward.`}>
        <View style={styles.legend}>
          {series.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <LineKey slot={s.slot} />
              <Text variant="caption" numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
        <ProjectionChart months={c.months} series={series} />
      </Card>

      <Card title="Side by side" subtitle={c.scenarios.length > 2 ? `Swipe sideways for all ${c.scenarios.length} →` : undefined}>
        <View style={{ flexDirection: "row" }}>
          <View style={styles.labels}>
            <View style={styles.headCell} />
            {rows.map((r) => (
              <View key={r.label} style={styles.rowCell}>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {r.label}
                </Text>
              </View>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            {c.scenarios.map((s) => (
              <View key={s.name} style={styles.col}>
                <View style={[styles.headCell, styles.headRow]}>
                  <LineKey slot={slotOf(s.name, scenarios)} />
                  <Text variant="label" numberOfLines={2} style={{ flex: 1 }}>
                    {s.name}
                  </Text>
                </View>
                {rows.map((r) => (
                  <View key={r.label} style={styles.rowCell}>
                    <Text variant="caption" style={styles.num} numberOfLines={2}>
                      {r.cell(s)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Card>

      {c.scenarios.map((s) => (
        <VerdictCard key={s.name} s={s} />
      ))}

      <Card title="Assumptions">
        {c.assumptions.map((a) => (
          <Text key={a} variant="caption" tone="muted">
            • {a}
          </Text>
        ))}
        <Text variant="caption" tone="muted">
          Checks: emergency fund ≥ 6 months of the new monthly outflow (warn under 6, risky under 3); all installments ≤ 30% of income and the car ≤ 20% (risky above +10 points);
          liquid money never below zero; income covers the monthly outflow. Any risky check makes the plan risky; any warning makes it tight.
        </Text>
        <Text variant="caption" tone="muted">
          Estimates from your own numbers, not financial advice.
        </Text>
      </Card>
    </>
  );
}

function VerdictCard({ s }: { s: CompareScenario }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title={s.name} action={<VerdictBadge v={s.verdict} />}>
      <Text>{plainVerdict(s.verdict, s.summary.lowestBalance.display)}</Text>
      {s.reasons.map((r) => (
        <Text key={r}>• {r}</Text>
      ))}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle} hitSlop={6}>
        <Text variant="caption" tone="muted">
          All checks
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} tone="muted" />
      </Pressable>
      {open
        ? s.rules.map((r) => (
            <View key={r.id} style={styles.rule} accessibilityLabel={`${r.status}: ${r.title}. ${r.detail}`}>
              <Icon name={STATUS[r.status].icon} size={14} tone={STATUS[r.status].tone} />
              <Text variant="caption" style={{ flex: 1 }}>
                <Text variant="caption" style={styles.strong}>
                  {r.title}.
                </Text>{" "}
                {r.detail}
              </Text>
            </View>
          ))
        : null}
    </Card>
  );
}

const ROW_H = 44;

const styles = StyleSheet.create((theme) => ({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  labels: { width: 128 },
  col: { width: 150, paddingLeft: 10 },
  headCell: { height: 48, justifyContent: "flex-end", paddingBottom: 6 },
  headRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  rowCell: { height: ROW_H, justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  num: { fontVariant: ["tabular-nums"] },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36 },
  rule: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  strong: { fontFamily: theme.fonts.bold },
}));
