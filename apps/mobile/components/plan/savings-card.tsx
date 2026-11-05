// "Where to save" on the phone: a read-only summary of plan.savings (the habits with a suggested cut and what they
// would save a month). Picking targets and adding the cuts to a scenario stays on the web's /plan for now; a cut
// added there opens and edits here like any other scenario item.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Card, ErrorState, SkeletonRows, Text } from "@/components/ui";
import { monthLabel } from "@/src/lib/format";
import { orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { habitLabel, savingsInput, suggestionText, type PlanState } from "@/src/lib/plan-state";

const SHOWN = 3;

export function SavingsCard({ state }: { state: PlanState }) {
  const q = useQuery({ ...orpc.plan.savings.queryOptions({ input: savingsInput(state) }), placeholderData: keepPreviousData });
  const d = q.data;
  if (q.isPending) {
    return (
      <Card title="Where to save">
        <SkeletonRows count={2} />
      </Card>
    );
  }
  if (!d) return q.isError ? <ErrorState compact error={q.error} onRetry={() => void q.refetch()} /> : null;

  const ready = d.habits.filter((h) => h.included && h.suggestion);
  const waiting = d.habits.filter((h) => !h.suggestion).length;
  const range = d.months.length ? `${monthLabel(d.months[0]!, "short")} – ${monthLabel(d.months[d.months.length - 1]!, "short")}` : "";
  return (
    <Card title="Where to save" subtitle={range ? `From your own habits, ${range}.` : "From your own habits."}>
      {!d.habits.length ? (
        <Text variant="caption" tone="muted">
          Nothing to work with yet: no coffee, snacks, eating out, delivery, ride-hailing, online shopping or minimarket rows in the last complete months.
        </Text>
      ) : null}
      {ready.slice(0, SHOWN).map((h) => {
        const s = h.suggestion!;
        return (
          <View key={h.key} style={styles.row} accessible accessibilityLabel={`${habitLabel(h)}: ${suggestionText(s)}, saves ${s.saving.display} a month`}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1}>{habitLabel(h)}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {suggestionText(s)} · average {h.averageTicket.display}
              </Text>
            </View>
            <Text tone="positive" style={styles.num}>
              +{s.saving.display}
            </Text>
          </View>
        );
      })}
      {ready.length ? (
        <Text variant="caption">
          With every suggestion, about <Text variant="caption" style={styles.strong}>{d.totalSaving.display}</Text> less spent a month
          {d.totalSavingIncomePct !== null ? ` (${String(d.totalSavingIncomePct).replace(".", ",")}% of recurring income)` : ""}. You choose which ones to change.
        </Text>
      ) : null}
      {waiting > 0 ? (
        <Text variant="caption" tone="muted">
          {waiting} habit{waiting > 1 ? "s" : ""} without enough data yet: suggestions start from 2 complete months and about 4 purchases a month.
        </Text>
      ) : null}
      {ready.length && !storeSafe ? (
        <Text variant="caption" tone="muted">
          To pick targets and add the cuts to a scenario, use Plan on the web; the cuts then show up in the scenario here.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  num: { fontVariant: ["tabular-nums"], fontFamily: theme.fonts.bold },
  strong: { fontFamily: theme.fonts.bold },
}));
