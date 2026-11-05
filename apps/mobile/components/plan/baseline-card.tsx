// "Your baseline": recurring income, core spending and existing installments from the ledger (each can be typed
// over), free cash, and each account's role in the plan. The web's BaselineCard in routes/plan.tsx.

import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Card, Icon, Pill, Text } from "@/components/ui";
import { formatMoney, monthLabel } from "@/src/lib/format";
import { effectiveBaseline, resetBaseline, ROLE_LABEL, ROLES, setRole, type PlanState } from "@/src/lib/plan-state";
import type { AppRouterClient, Out } from "@/src/lib/rpc";

import { Cell, FieldGrid, MoneyField } from "./fields";

export type Baseline = Out<AppRouterClient["plan"]["baseline"]>;

export const rp = (minor: number) => formatMoney(Math.round(minor / 100) * 100);
const bare = (minor: number) => rp(minor).replace("Rp ", "").replace("Rp", "");

export function BaselineCard({ b, state, update }: { b: Baseline; state: PlanState; update: (fn: (s: PlanState) => PlanState) => void }) {
  const [details, setDetails] = useState(false);
  const e = effectiveBaseline(b, state);
  const range = b.months.length ? `${monthLabel(b.months[0]!, "short")} – ${monthLabel(b.months[b.months.length - 1]!)}` : "";
  const used = b.history.monthsUsed;
  const span = used < b.history.monthsRequested ? ` (${used} ${used === 1 ? "month" : "months"} of history)` : "";
  const thin = !e.empty && b.history.tooLittle;
  return (
    <Card
      title="Your baseline"
      subtitle={e.empty ? "Type your own numbers to start." : `From ${range}${span}. Change any number to try something else.`}
      action={e.edited ? <Button title="Reset to ledger" variant="ghost" small onPress={() => update(resetBaseline)} /> : undefined}
    >
      {e.empty ? (
        <View style={styles.warn}>
          <Text variant="caption" tone="warning">
            No complete months in your ledger yet, so there is nothing to start from. Import a few months of statements, or type your monthly income and spending below to try scenarios now.
          </Text>
        </View>
      ) : null}
      {thin ? (
        <View style={styles.warn}>
          <Text variant="caption" tone="warning">
            Only {used} complete month of history so far, so these numbers are rough. Check them, or type your usual income and spending below.
          </Text>
        </View>
      ) : null}
      <FieldGrid>
        <Cell label="Recurring income / month" hint={`Ledger: ${b.income.recurring.display}`}>
          <MoneyField label="Monthly income" value={state.monthlyIncome} placeholder={bare(b.income.recurring.amount)} onChange={(v) => update((s) => ({ ...s, monthlyIncome: v }))} />
        </Cell>
        <Cell label="Core spending / month" hint={`Ledger: ${b.spending.monthly.display} (one-offs left out)`}>
          <MoneyField label="Monthly spending" value={state.monthlySpending} placeholder={bare(b.spending.monthly.amount)} onChange={(v) => update((s) => ({ ...s, monthlySpending: v }))} />
        </Cell>
        <Cell label="Existing installments / month" hint="Loan payments are transfers, not spending">
          <MoneyField
            label="Existing installments"
            value={state.existingInstallments}
            placeholder={bare(b.existingInstallments.monthly.amount)}
            onChange={(v) => update((s) => ({ ...s, existingInstallments: v }))}
          />
        </Cell>
        <Cell label="Free cash / month">
          <View style={styles.free}>
            <Text variant="heading" tone={e.free < 0 ? "destructive" : "default"} style={styles.num}>
              {rp(e.free)}
            </Text>
          </View>
        </Cell>
      </FieldGrid>

      <View style={{ gap: 6, marginTop: 8 }}>
        <Text variant="caption" tone="muted" style={styles.upper}>
          Savings by role
        </Text>
        <Text variant="caption" tone="muted" style={styles.num}>
          Emergency {rp(e.totals.emergency)} · Goal {rp(e.totals.goal)} · Spending {rp(e.totals.spending)}
        </Text>
        {b.accounts.map((a) => {
          const role = state.roles[a.id] ?? a.suggestedRole;
          return (
            <View key={a.id} style={styles.account}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {a.name}
                </Text>
                <Text variant="caption" tone="muted" style={styles.num}>
                  {a.balance.display}
                </Text>
              </View>
              <View style={styles.roles} accessibilityRole="radiogroup" accessibilityLabel={`Role of ${a.name}`}>
                {ROLES.map((r) => (
                  <Pill key={r} label={ROLE_LABEL[r]} selected={role === r} onPress={() => update((s) => setRole(s, a.id, r, a.suggestedRole))} />
                ))}
              </View>
              {role === a.suggestedRole && a.reason ? (
                <Text variant="caption" tone="muted">
                  Suggested: {a.reason}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.toggle} hitSlop={6}>
        <Text variant="caption" tone="muted">
          How these were worked out
        </Text>
        <Icon name={details ? "chevron-up" : "chevron-down"} size={14} tone="muted" />
      </Pressable>
      {details ? (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 4 }}>
            <Text variant="caption" tone="muted" style={styles.upper}>
              Income sources
            </Text>
            {b.income.sources.map((s) => (
              <View key={s.slug ?? "none"} style={styles.line}>
                <Text variant="caption" style={[{ flex: 1 }, s.irregular && styles.struck]} tone={s.irregular ? "muted" : "default"}>
                  {s.name} ({s.monthsPresent}/{b.months.length} mo)
                </Text>
                <Text variant="caption" style={styles.num}>
                  {s.irregular ? `avg ${s.average.display}` : s.recurring.display}
                </Text>
              </View>
            ))}
            <Text variant="caption" tone="muted">
              Crossed out: irregular, not counted. Regular sources use the lower of average and median; salary uses its median.
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text variant="caption" tone="muted" style={styles.upper}>
              One-offs left out of spending
            </Text>
            {b.spending.excluded.length ? (
              b.spending.excluded.map((x) => (
                <View key={x.id} style={styles.line}>
                  <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                    {x.description} <Text variant="caption" tone="muted">{x.date}</Text>
                  </Text>
                  <Text variant="caption" style={styles.num}>
                    {x.display}
                  </Text>
                </View>
              ))
            ) : (
              <Text variant="caption" tone="muted">
                None.
              </Text>
            )}
            <Text variant="caption" tone="muted">
              {b.spending.outlierRule}. Spending with them: {b.spending.average.display} on average.
            </Text>
          </View>
          {b.notes.map((n) => (
            <Text key={n} variant="caption" tone="muted">
              • {n}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  warn: { backgroundColor: theme.colors.warningSoft, borderRadius: theme.radius.tile, padding: 12 },
  free: { minHeight: 48, justifyContent: "center", backgroundColor: theme.colors.muted, borderRadius: theme.radius.input, paddingHorizontal: 12 },
  num: { fontVariant: ["tabular-nums"] },
  upper: { textTransform: "uppercase", letterSpacing: 0.5, fontFamily: theme.fonts.medium },
  account: { gap: 6, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36 },
  line: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  struck: { textDecorationLine: "line-through" },
}));
