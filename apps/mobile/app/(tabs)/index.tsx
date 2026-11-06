// Home: the month at a glance, at parity with the web dashboard (apps/web/src/routes/-dashboard.tsx). One
// reports.dashboard call per month (persisted, so it opens offline); pull to refresh; tap anything to open the
// matching transactions.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { BalanceCard, HeroGrid, HeroStat, HeroText } from "@/components/accounts/balance-card";
import { BudgetSheet, type BudgetTarget } from "@/components/budgets/budget-sheet";
import { CashflowChart } from "@/components/charts/cashflow";
import { DonutChart, LegendRow, Swatch } from "@/components/charts/donut";
import { PaceChart } from "@/components/charts/pace";
import { useMe } from "@/components/data";
import { Avatar, Button, Card, Disclosure, EmptyState, ErrorState, Icon, IconButton, Pill, Row, Screen, SkeletonCard, Text } from "@/components/ui";
import { isCaptureSupported, NotificationCapture } from "@/modules/notification-capture";
import { counts } from "@/src/capture/queue";
import { useCaptures } from "@/src/capture/store";
import { shortName } from "@/src/lib/accounts";
import { openAddSheet } from "@/src/lib/add-sheet";
import { attentionItems, balanceSplit, changeText, delta, donutSlices, keyOf, monthRange, OTHER, periodLabel, type Dashboard, type FilterLink } from "@/src/lib/dashboard";
import { currentMonthWib, monthLabel, shiftMonth } from "@/src/lib/format";
import { orpc } from "@/src/lib/orpc";
import { useSettings } from "@/src/lib/settings";
import { filtersToParams } from "@/src/lib/transaction-filters";

export default function Home() {
  const router = useRouter();
  const thisMonth = currentMonthWib();
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ ...orpc.reports.dashboard.queryOptions({ input: { month } }), placeholderData: keepPreviousData });
  const openTransactions = (link: FilterLink) => router.navigate({ pathname: "/transactions", params: filtersToParams(link) });

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <Header />
      <Screen refreshing={q.isRefetching && !q.isPlaceholderData} onRefresh={() => void q.refetch()}>
        <MonthSwitcher month={month} thisMonth={thisMonth} onChange={setMonth} />
        {q.isError && q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
        {q.isPending ? (
          <>
            <SkeletonCard height={300} />
            <SkeletonCard height={200} />
            <SkeletonCard lines={4} />
          </>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data ? (
          <View style={[styles.body, q.isPlaceholderData && { opacity: 0.6 }]}>
            <Body d={q.data} onMonth={setMonth} openTransactions={openTransactions} />
          </View>
        ) : null}
        <Shortcuts />
      </Screen>
    </SafeAreaView>
  );
}

function Header() {
  const me = useMe();
  const router = useRouter();
  const first = me?.user.name?.split(" ")[0];
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {me?.household.name ?? "JoyoArto"}
          {me?.demo ? " · demo" : ""}
        </Text>
        <Text variant="title" numberOfLines={1}>
          {first ? `Hi, ${first}` : "Home"}
        </Text>
      </View>
      <Pressable onPress={() => router.navigate("/more")} accessibilityRole="button" accessibilityLabel="Profile and more" hitSlop={8}>
        <Avatar name={me?.user.name ?? null} image={me?.user.image ?? null} size={40} />
      </Pressable>
    </View>
  );
}

function MonthSwitcher({ month, thisMonth, onChange }: { month: string; thisMonth: string; onChange: (m: string) => void }) {
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

/** The collapsed quick add: tap to open the add sheet. */
function QuickAddCard() {
  return (
    <Pressable onPress={() => openAddSheet()} accessibilityRole="button" accessibilityLabel="Quick add a transaction" style={({ pressed }) => [styles.quick, pressed && { opacity: 0.85 }]}>
      <View style={styles.quickIcon}>
        <Icon name="add" tone="primary" />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label">Quick add</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          “kopi 25rb gopay”, “gaji masuk 16 juta”
        </Text>
      </View>
      <Icon name="chevron-forward" tone="muted" size={18} />
    </Pressable>
  );
}

function Body({ d, onMonth, openTransactions }: { d: Dashboard; onMonth: (m: string) => void; openTransactions: (l: FilterLink) => void }) {
  const router = useRouter();
  if (!d.accounts.groups.length) {
    return (
      <EmptyState
        icon="wallet-outline"
        title="Welcome to JoyoArto"
        description="Add an account and import a statement to see where your money goes."
        action={<Button title="Import a statement" small onPress={() => router.push("/import")} />}
      />
    );
  }
  return (
    <>
      <Overview d={d} />
      <QuickAddCard />
      <Categories d={d} openTransactions={openTransactions} />
      <Cashflow d={d} onMonth={onMonth} />
      <Pace d={d} />
      <Attention d={d} openTransactions={openTransactions} />
      <Budgets d={d} />
      <Merchants d={d} openTransactions={openTransactions} />
      <Balances d={d} openTransactions={openTransactions} />
    </>
  );
}

/** Change vs the comparison period on the balance card: arrow and sign carry good/bad (no status colours there). */
function HeroDelta({ value, vs, unit }: { value: number | null | undefined; vs: string; unit?: "pct" | "pts" }) {
  const dl = delta(value, true, unit);
  return (
    <HeroText numberOfLines={1}>
      {dl ? <HeroText strong>{dl.text}</HeroText> : null}
      <HeroText faint>{dl ? ` vs ${vs}` : `no comparison for ${vs}`}</HeroText>
    </HeroText>
  );
}

/** Top of Home, like a bank app's balance card: today's total, its split by account type, and the month's figures. */
function Overview({ d }: { d: Dashboard }) {
  const vs = periodLabel(d);
  const k = d.kpis;
  const sr = k.savingsRate;
  const count = d.accounts.groups.reduce((n, g) => n + g.accounts.length, 0);
  return (
    <BalanceCard total={d.accounts.total.display} caption={`${count} account${count === 1 ? "" : "s"} · today`} split={balanceSplit(d.accounts.groups)}>
      <HeroGrid>
        <HeroStat label="Income" value={k.income.display} delta={<HeroDelta value={k.income.changePct} vs={vs} />} />
        <HeroStat label="Spending" value={k.spending.display} delta={<HeroDelta value={k.spending.changePct} vs={vs} />} />
        <HeroStat label="Net" value={k.net.display} delta={<HeroDelta value={k.net.changePct} vs={vs} />} />
        <HeroStat
          label="Savings rate"
          value={sr.value === null ? "–" : `${sr.value}%`}
          delta={
            sr.note ? (
              <HeroText faint numberOfLines={1}>{sr.note === "too-early" ? "too early in the month" : "spending far above income"}</HeroText>
            ) : (
              <HeroDelta value={sr.value !== null && sr.previous !== null ? Math.round((sr.value - sr.previous) * 10) / 10 : null} vs={vs} unit="pts" />
            )
          }
        />
      </HeroGrid>
      <HeroText faint>{monthLabel(d.month)} · transfers between your own accounts are not counted</HeroText>
    </BalanceCard>
  );
}

function Categories({ d, openTransactions }: { d: Dashboard; openTransactions: (l: FilterLink) => void }) {
  const { theme } = useUnistyles();
  const [active, setActive] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const prev = periodLabel(d);
  const range = monthRange(d);
  const { slices, top, rest, other } = donutSlices(d);
  const linkOf = (c: { slug: string | null }): FilterLink => (c.slug ? { category: c.slug, ...range } : { uncategorized: true, ...range });
  const color = (i: number) => theme.viz.series[i] ?? theme.viz.previous;
  const summary = `Spending by category, ${monthLabel(d.month)}: ${d.kpis.spending.display}. ${slices.map((s) => `${s.label} ${s.display} (${s.share}%)`).join(", ")}.`;
  const select = (key: string) => {
    if (key === OTHER) return setShowRest(!showRest);
    const c = top.find((x) => keyOf(x) === key);
    if (c) openTransactions(linkOf(c));
  };
  return (
    <Card title="Spending by category" subtitle={`${d.kpis.spending.display} · share · change vs ${prev}`}>
      {!d.categories.length ? (
        <Text tone="muted">No spending this month.</Text>
      ) : (
        <>
          <View style={{ alignItems: "center", paddingVertical: 4 }}>
            <DonutChart slices={slices} centerLabel="Spending" centerValue={d.kpis.spending.display} active={active} onSelect={(k) => (active === k ? select(k) : setActive(k))} label={summary} />
          </View>
          <View>
            {top.map((c, i) => (
              <LegendRow
                key={keyOf(c)}
                color={color(i)}
                label={c.name}
                value={c.display}
                detail={`${c.share}% · ${changeText(c)} vs ${prev}`}
                active={active === keyOf(c)}
                onPress={() => openTransactions(linkOf(c))}
              />
            ))}
            {other ? (
              <>
                <LegendRow color={theme.viz.previous} label={`Other (${rest.length})`} value={other.display} detail={`${other.share}% · ${changeText(other)} vs ${prev}`} active={active === OTHER} onPress={() => setShowRest(!showRest)} />
                {showRest
                  ? rest.map((c) => <LegendRow key={keyOf(c)} color={null} label={c.name} value={c.display} detail={`${c.share}% · ${changeText(c)} vs ${prev}`} onPress={() => openTransactions(linkOf(c))} />)
                  : null}
              </>
            ) : null}
          </View>
        </>
      )}
    </Card>
  );
}

function Cashflow({ d, onMonth }: { d: Dashboard; onMonth: (m: string) => void }) {
  const { theme } = useUnistyles();
  const months = d.cashflow.map((m) => ({
    month: m.month,
    label: monthLabel(m.month, "short"),
    income: m.income.amount,
    expense: m.expense.amount,
    incomeDisplay: m.income.display,
    expenseDisplay: m.expense.display,
  }));
  const sel = d.cashflow.find((m) => m.month === d.month);
  return (
    <Card title="Cash flow" subtitle="Last 6 months · tap a month to open it">
      <Row gap={14}>
        <Row gap={6}>
          <Swatch color={theme.viz.series[0]} />
          <Text variant="caption" tone="muted">Income</Text>
        </Row>
        <Row gap={6}>
          <Swatch color={theme.viz.series[1]} />
          <Text variant="caption" tone="muted">Spending</Text>
        </Row>
      </Row>
      <CashflowChart months={months} selected={d.month} onSelect={onMonth} currency={d.currency} />
      {sel ? (
        <Text variant="caption" tone="muted" style={styles.num}>
          {monthLabel(sel.month, "short")}: in {sel.income.display}, out {sel.expense.display}, net {sel.net.display}
        </Text>
      ) : null}
      <Disclosure plain title="Table">
        <TableRow head cells={["Month", "In", "Out", "Net"]} />
        {d.cashflow.map((m) => (
          <TableRow key={m.month} cells={[monthLabel(m.month, "short"), m.income.display, m.expense.display, m.net.display]} />
        ))}
      </Disclosure>
    </Card>
  );
}

function Pace({ d }: { d: Dashboard }) {
  const { theme } = useUnistyles();
  const cur = monthLabel(d.month, "short");
  const prev = monthLabel(d.previousMonth, "short");
  const points = d.spendingByDay.map((p) => ({ day: p.day, current: p.current?.amount ?? null, previous: p.previous.amount }));
  const today = d.isCurrentMonth ? Number(d.today.slice(8)) : points.length;
  const at = d.spendingByDay[Math.min(today, points.length) - 1];
  let sub = "Running total by day of month";
  if (at?.current && d.isCurrentMonth) {
    const diff = at.current.amount - at.previous.amount;
    sub = `Day ${at.day}: ${at.current.display}, ${diff === 0 ? "same as" : diff > 0 ? "more than" : "less than"} ${prev}'s ${at.previous.display} by this day`;
  }
  return (
    <Card title="Spending pace" subtitle={sub}>
      <Row gap={14}>
        <Row gap={6}>
          <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: theme.viz.series[0] }} />
          <Text variant="caption" tone="muted">{d.isCurrentMonth ? `${cur} (so far)` : cur}</Text>
        </Row>
        <Row gap={6}>
          <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: theme.viz.previous }} />
          <Text variant="caption" tone="muted">{prev}</Text>
        </Row>
      </Row>
      <PaceChart points={points} label={`Spending pace. ${sub}`} />
      <Disclosure plain title="Table">
        <TableRow head cells={["Day", cur, prev]} />
        {d.spendingByDay
          .filter((p) => p.day % 5 === 0 || p.day === 1 || p.day === d.spendingByDay.length)
          .map((p) => (
            <TableRow key={p.day} cells={[String(p.day), p.current?.display ?? "–", p.previous.display]} />
          ))}
      </Disclosure>
    </Card>
  );
}

function Attention({ d, openTransactions }: { d: Dashboard; openTransactions: (l: FilterLink) => void }) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const items = attentionItems(d);
  return (
    <Card title="Needs attention" subtitle={d.attention.pending ? `${d.attention.pending} pending quick add${d.attention.pending === 1 ? "" : "s"} count already` : undefined}>
      {items.length ? (
        items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            onPress={() => (it.link === "import" ? router.push("/import") : it.link === "reimburse" ? router.push("/reimburse") : openTransactions(it.link))}
            style={({ pressed }) => [styles.attention, pressed && { backgroundColor: theme.colors.muted }]}
          >
            <View style={[styles.dot, { backgroundColor: theme.viz.warning }]} />
            <Text style={{ flex: 1 }}>{it.text}</Text>
            <Icon name="chevron-forward" size={16} tone="muted" />
          </Pressable>
        ))
      ) : (
        <Text tone="positive">✓ All caught up: everything is categorized and every account is current.</Text>
      )}
    </Card>
  );
}

const BUDGET_STATUS = {
  over: { icon: "✕", label: "Over" },
  ahead_of_pace: { icon: "!", label: "Ahead of pace" },
  on_track: { icon: "✓", label: "On track" },
} as const;

function Budgets({ d }: { d: Dashboard }) {
  const { theme } = useUnistyles();
  const [target, setTarget] = useState<BudgetTarget | null>(null);
  const items = d.budgets.items;
  return (
    <Card
      title="Budgets"
      subtitle={items.length ? `${d.budgets.total.spent} of ${d.budgets.total.budget}` : undefined}
      action={<Button title={items.length ? "Add" : "Set budgets"} icon="add" variant="ghost" small onPress={() => setTarget("new")} />}
    >
      {!items.length ? <Text tone="muted">No budgets yet. Set a monthly limit per category to track your pace.</Text> : null}
      {items.map((b) => {
        const s = BUDGET_STATUS[b.status as keyof typeof BUDGET_STATUS] ?? BUDGET_STATUS.on_track;
        const fill = b.status === "over" ? theme.viz.critical : b.status === "ahead_of_pace" ? theme.viz.warning : theme.viz.series[0];
        return (
          <Pressable
            key={b.category}
            onPress={() => setTarget({ category: b.category, name: b.name, amount: b.budget.amount })}
            accessibilityRole="button"
            accessibilityHint="Change or remove this budget"
            accessibilityLabel={`${b.name}: ${b.spent.display} of ${b.budget.display}, ${b.usedPct}% used, ${s.label}`}
            style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.7 }]}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Text numberOfLines={1} style={{ flex: 1 }}>{b.name}</Text>
              <Text variant="caption" tone="muted" style={styles.num}>
                {b.spent.display} / {b.budget.display}
              </Text>
            </Row>
            <View style={[styles.track, { backgroundColor: theme.viz.seriesTrack }]}>
              <View style={[styles.fill, { width: `${Math.min(100, b.usedPct)}%`, backgroundColor: fill }]} />
              {d.isCurrentMonth && b.pacePct > 0 && b.pacePct < 100 ? <View style={[styles.tick, { left: `${b.pacePct}%`, backgroundColor: theme.colors.foreground }]} /> : null}
            </View>
            <Text variant="caption" tone="muted">
              {s.icon} {s.label} · {b.usedPct}% used · {b.status === "over" ? `${b.remaining.display.replace("-", "")} over` : `${b.remaining.display} left`}
            </Text>
          </Pressable>
        );
      })}
      {items.length ? (
        <Disclosure plain title="How budgets work">
          {`Tap a budget to change or remove it.${d.isCurrentMonth ? " The tick on each bar marks an even pace for today: past it, you are spending faster than the month." : ""}`}
        </Disclosure>
      ) : null}
      <BudgetSheet target={target} budgeted={items.map((b) => b.category)} onClose={() => setTarget(null)} />
    </Card>
  );
}

function Merchants({ d, openTransactions }: { d: Dashboard; openTransactions: (l: FilterLink) => void }) {
  const { theme } = useUnistyles();
  if (!d.merchants.length) return null;
  const range = monthRange(d);
  return (
    <Card title="Top merchants" subtitle="Biggest spending this month">
      {d.merchants.map((m, i) => (
        <Pressable key={m.name} accessibilityRole="button" onPress={() => openTransactions({ q: m.name.slice(0, 40), ...range })} style={({ pressed }) => [styles.merchant, pressed && { backgroundColor: theme.colors.muted }]}>
          <Text variant="caption" tone="muted" style={{ width: 16 }}>{i + 1}</Text>
          <Text numberOfLines={1} style={{ flex: 1 }}>{m.name}</Text>
          <Text variant="caption" tone="muted">{m.count}×</Text>
          <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{m.display}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

function Balances({ d, openTransactions }: { d: Dashboard; openTransactions: (l: FilterLink) => void }) {
  const { theme } = useUnistyles();
  return (
    <Card title="Balances" subtitle="By account, today" action={<Text variant="heading" style={{ fontVariant: ["tabular-nums"] }}>{d.accounts.total.display}</Text>}>
      {d.accounts.groups.map((g) => (
        <View key={g.type} style={{ gap: 2 }}>
          <Row style={styles.groupHead}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>{g.label}</Text>
            <Text variant="caption" tone="muted" style={styles.num}>{g.total.display}</Text>
          </Row>
          {g.accounts.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" onPress={() => openTransactions({ accountId: a.id })} style={({ pressed }) => [styles.balance, pressed && { backgroundColor: theme.colors.muted }]}>
              <Text numberOfLines={1} style={{ flex: 1 }}>{shortName(a.name, a.institution)}</Text>
              <Text variant="label" tone={a.balance.amount < 0 ? "destructive" : "default"} style={{ fontVariant: ["tabular-nums"] }}>
                {a.balance.display}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      <Disclosure plain title="How balances are worked out">
        Each balance is the opening balance plus every recorded transaction, pending quick adds included. Debts (cards, loans) are subtracted from the total.
      </Disclosure>
    </Card>
  );
}

/** One line of a small table behind a chart: first cell left, figures right-aligned in tabular numbers. */
function TableRow({ cells, head }: { cells: string[]; head?: boolean }) {
  return (
    <Row gap={8}>
      {cells.map((c, i) => (
        <Text key={i} variant="caption" tone={head ? "muted" : "default"} numberOfLines={1} style={[styles.num, i === 0 ? { width: 44 } : { flex: 1, textAlign: "right" }]}>
          {c}
        </Text>
      ))}
    </Row>
  );
}

/** Captured notifications (Android) and statement import, as before. */
function Shortcuts() {
  const router = useRouter();
  const settings = useSettings();
  const captures = useCaptures();
  const c = counts(captures);
  const captureReady = isCaptureSupported && settings.captureEnabled && NotificationCapture.isPermissionGranted();
  const go = (href: Href) => router.push(href);
  return (
    <>
      {Platform.OS === "android" ? (
        <Card onPress={() => go(captureReady ? "/captured" : "/capture-setup")} tone={captureReady ? "default" : "primary"} accessibilityLabel="Captured payments">
          <Row style={{ justifyContent: "space-between" }}>
            <Row>
              <Icon name="notifications-outline" tone="primary" />
              <Text variant="heading">Captured</Text>
            </Row>
            <Icon name="chevron-forward" tone="muted" />
          </Row>
          {captureReady ? (
            <Row style={{ flexWrap: "wrap" }}>
              <Pill tone="positive" label={`${c.sent} sent`} />
              {c.review ? <Pill tone="warning" label={`${c.review} to check`} /> : null}
              {c.queued + c.sending ? <Pill tone="primary" label={`${c.queued + c.sending} waiting`} /> : null}
              {c.failed ? <Pill tone="destructive" label={`${c.failed} failed`} /> : null}
            </Row>
          ) : (
            <Text tone="muted">Turn on capture to save Jago and GoPay payments from their notifications.</Text>
          )}
        </Card>
      ) : null}
      <Card onPress={() => go("/import")} accessibilityLabel="Import statements">
        <Row style={{ justifyContent: "space-between" }}>
          <Row>
            <Icon name="document-text-outline" tone="primary" />
            <Text variant="heading">Import statements</Text>
          </Row>
          <Icon name="chevron-forward" tone="muted" />
        </Row>
        <Text tone="muted">{Platform.OS === "android" ? "Share a Jago or GoPay PDF to JoyoArto, or pick one here." : "Pick a Jago or GoPay PDF from Files."}</Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.xs },
  switcher: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill, paddingHorizontal: 2 },
  quick: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.card, borderRadius: theme.radius.card, paddingHorizontal: 16, paddingVertical: 12 },
  quickIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primarySoft },
  body: { gap: theme.spacing.md },
  num: { fontVariant: ["tabular-nums"] },
  attention: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 8, borderRadius: 4, overflow: "visible" },
  fill: { height: 8, borderRadius: 4 },
  tick: { position: "absolute", top: -2, width: 2, height: 12, borderRadius: 1 },
  merchant: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  groupHead: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, paddingBottom: 4, marginTop: 4 },
  balance: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
}));
