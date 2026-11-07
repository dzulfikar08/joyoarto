// Money flow (the web's /flow): where one month's money came from and where it went, as a band chart, with the
// explanation and the numbers behind it folded away. Tap a group to highlight it, tap again to open its transactions.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MoneyFlowChart, useFlowColors, type FlowUnit, type MoneyFlow } from "@/components/charts/flow";
import { MonthSwitcher } from "@/components/month-switcher";
import { Button, Card, Disclosure, EmptyState, ErrorState, Row, Screen, Segmented, SkeletonCard, Text } from "@/components/ui";
import { flowPct } from "@baroka/api/lib/flow";
import { compactMoney, currentMonthWib } from "@/src/lib/format";
import { orpc } from "@/src/lib/orpc";
import { filtersToParams } from "@/src/lib/transaction-filters";

export default function FlowScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string }>();
  const thisMonth = currentMonthWib();
  const [month, setMonth] = useState(params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : thisMonth);
  const [unit, setUnit] = useState<FlowUnit>("amount");
  const q = useQuery({ ...orpc.reports.flow.queryOptions({ input: { month } }), placeholderData: keepPreviousData });
  const flow = q.data;

  return (
    <Screen refreshing={q.isRefetching && !q.isPlaceholderData} onRefresh={() => void q.refetch()}>
      <MonthSwitcher month={month} thisMonth={thisMonth} onChange={setMonth} />
      {q.isError && flow ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {q.isPending ? (
        <>
          <SkeletonCard height={80} />
          <SkeletonCard height={420} />
        </>
      ) : q.isError && !flow ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : flow && !flow.nodes.length ? (
        <EmptyState
          icon="git-network-outline"
          title="Nothing came in or went out"
          description="Import a statement to see where your money goes."
          action={<Button title="Import a statement" small onPress={() => router.push("/import")} />}
        />
      ) : flow ? (
        <View style={[styles.body, q.isPlaceholderData && { opacity: 0.6 }]}>
          <Row gap={8}>
            <Stat label="Money in" value={flow.income.amount} currency={flow.currency} />
            <Stat label="Spent" value={flow.spending.amount} currency={flow.currency} />
            {flow.saved.amount > 0 ? (
              <Stat label="Saved" value={flow.saved.amount} currency={flow.currency} tone="positive" />
            ) : (
              <Stat label="From savings" value={flow.fromSavings.amount} currency={flow.currency} tone="warning" />
            )}
          </Row>
          <Card>
            <Segmented
              label="Show"
              value={unit}
              onChange={setUnit}
              options={[
                { value: "amount", label: "Rp" },
                { value: "pct", label: "%" },
              ]}
            />
            <MoneyFlowChart
              flow={flow}
              unit={unit}
              onOpen={(n) =>
                router.navigate({ pathname: "/transactions", params: filtersToParams(n.slug ? { category: n.slug, from: flow.from, to: flow.to } : { uncategorized: true, from: flow.from, to: flow.to }) })
              }
            />
            <Text variant="caption" tone="muted">
              Tap a group to highlight it, tap again to see its transactions.
            </Text>
          </Card>
          <Disclosure title="What is Money flow?" icon="information-circle-outline">
            <Text tone="muted">
              The chart traces the month's money from where it came in, through your spending groups, to the categories you
              spent it on. The thicker a band, the more money went that way.
            </Text>
            <Text tone="muted">
              Transfers between your own accounts, e-wallet top-ups and card payments are left out, and so are expenses your
              employer will pay back. When spending was more than income, the difference shows as From savings.
            </Text>
          </Disclosure>
          <Disclosure title="The numbers" icon="list-outline">
            <Numbers flow={flow} />
          </Disclosure>
        </View>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, currency, tone }: { label: string; value: number; currency: string; tone?: "positive" | "warning" }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="heading" tone={tone === "positive" ? "positive" : tone === "warning" ? "warning" : "default"} numberOfLines={1} adjustsFontSizeToFit style={styles.num}>
        Rp {compactMoney(value, currency)}
      </Text>
    </View>
  );
}

function Numbers({ flow }: { flow: MoneyFlow }) {
  const colors = useFlowColors(flow);
  const total = flow.nodes.find((n) => n.kind === "hub")?.amount ?? 0;
  const line = (key: string, label: string, amount: number, opts: { color?: string; strong?: boolean; indent?: boolean } = {}) => (
    <Row key={key} gap={8} style={[styles.line, opts.indent && { paddingLeft: 18 }]}>
      {opts.color ? <View style={[styles.dot, { backgroundColor: opts.color }]} /> : null}
      <Text variant={opts.strong ? "label" : "body"} tone={opts.indent ? "muted" : "default"} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={opts.strong ? "label" : "body"} tone={opts.indent ? "muted" : "default"} style={styles.num}>
        Rp {compactMoney(amount, flow.currency)}
        {opts.indent ? "" : `  ${flowPct(amount, total)}`}
      </Text>
    </Row>
  );
  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text variant="caption" tone="muted">
          CAME IN
        </Text>
        {flow.nodes.filter((n) => n.kind === "source").map((n) => line(n.id, n.label, n.amount))}
      </View>
      <View>
        <Text variant="caption" tone="muted">
          WENT TO
        </Text>
        {flow.nodes
          .filter((n) => n.kind === "group" || n.kind === "saved")
          .flatMap((g) => [
            line(g.id, g.label, g.amount, { color: colors.get(g.id), strong: true }),
            ...flow.nodes.filter((n) => n.kind === "item" && n.group === g.id).map((n) => line(n.id, n.label, n.amount, { indent: true })),
          ])}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing.md },
  stat: { flex: 1, minWidth: 0, gap: 2, backgroundColor: theme.colors.card, borderRadius: theme.radius.card, paddingHorizontal: 14, paddingVertical: 12 },
  num: { fontVariant: ["tabular-nums"] },
  line: { alignItems: "center", paddingVertical: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
}));
