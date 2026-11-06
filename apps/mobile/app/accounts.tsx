// Accounts: balances (archived ones collapsed), add an account, open one for its details. At parity with the web's
// apps/web/src/routes/accounts.tsx (its "Recent imports" list lives on the Import screen here).

import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { AccountFormSheet } from "@/components/accounts/account-form";
import { BalanceCard } from "@/components/accounts/balance-card";
import { Button, Disclosure, EmptyState, ErrorState, IconButton, ListRow, ListSection, Money, Screen, SkeletonCard, Text } from "@/components/ui";
import { groupByType, idrTotal, institutionBadge, institutionLabel, shortName, splitArchived, type AccountRow } from "@/src/lib/accounts";
import { balanceSplit } from "@/src/lib/dashboard";
import { formatMoney, plural } from "@/src/lib/format";
import { orpc } from "@/src/lib/orpc";

export default function AccountsScreen() {
  const router = useRouter();
  const q = useQuery(orpc.accounts.list.queryOptions({ input: { includeArchived: true } }));
  const [adding, setAdding] = useState(false);
  // Stable options: a new object each render makes expo-router call setOptions every time.
  const screenOptions = useMemo(() => ({ headerRight: () => <IconButton name="add" label="Add an account" onPress={() => setAdding(true)} /> }), []);
  const { active, archived } = splitArchived(q.data?.accounts ?? []);
  const groups = groupByType(active);
  const split = balanceSplit(groups.map((g) => ({ type: g.type, label: g.label, total: { amount: g.total, display: formatMoney(g.total) } })));

  const row = (a: AccountRow) => {
    const name = shortName(a.name, a.institution);
    return (
      <ListRow
        key={a.id}
        left={
          <View style={styles.badge}>
            <Text variant="caption" style={styles.badgeText}>{institutionBadge(a.institution)}</Text>
          </View>
        }
        title={a.last4 ? `${name} ··${a.last4}` : name}
        subtitle={[institutionLabel(a.institution), plural(a.transactions, "transaction"), a.lastDate ? `last ${a.lastDate}` : null].filter(Boolean).join(" · ")}
        right={<Money amount={a.balance.amount} display={a.balance.display} tone={a.balance.amount < 0 ? "destructive" : "default"} variant="label" style={styles.balance} />}
        onPress={() => router.push({ pathname: "/account/[id]", params: { id: a.id } })}
        accessibilityLabel={`${a.name}, ${a.balance.display}`}
      />
    );
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={screenOptions} />
      {q.isError && q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {q.isPending ? (
        <>
          <SkeletonCard height={140} />
          <SkeletonCard lines={3} />
        </>
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !active.length && !archived.length ? (
        <EmptyState
          icon="wallet-outline"
          title="No accounts yet"
          description="Add a bank account, card or e-wallet, or import a Bank Jago statement: its pockets become accounts."
          action={<Button title="Add an account" small icon="add" onPress={() => setAdding(true)} />}
        />
      ) : (
        <>
          {active.length ? <BalanceCard total={formatMoney(idrTotal(active))} caption={`${plural(active.length, "account")} · today`} split={split} /> : null}
          {groups.map((g) => (
            <ListSection key={g.type} title={`${g.label} · ${formatMoney(g.total)}`}>
              {g.items.map(row)}
            </ListSection>
          ))}
          {archived.length ? (
            <Disclosure title={`Archived (${archived.length})`} icon="archive-outline">
              <Text variant="caption" tone="muted">Hidden from pickers and Home. Open one to unarchive it.</Text>
              <View style={styles.archived}>
                <ListSection>{archived.map(row)}</ListSection>
              </View>
            </Disclosure>
          ) : null}
          <Button title="Add an account" variant="secondary" icon="add" onPress={() => setAdding(true)} />
          <Disclosure title="How balances work" icon="information-circle-outline">
            Balance = opening balance plus every recorded transaction (pending quick adds too). Card and loan balances are negative and lower the total. Tap an account to edit it, archive it or see its transactions.
          </Disclosure>
        </>
      )}
      <AccountFormSheet open={adding} account={null} onClose={() => setAdding(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primarySoft },
  badgeText: { fontFamily: theme.fonts.heavy, color: theme.colors.primaryInk, letterSpacing: 0.3 },
  balance: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.base },
  archived: { marginHorizontal: -theme.spacing.lg, opacity: 0.75 },
}));
