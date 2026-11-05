// Accounts: balances (archived ones collapsed), add an account, open one for its details. At parity with the web's
// apps/web/src/routes/accounts.tsx (its "Recent imports" list lives on the Import screen here).

import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";

import { AccountFormSheet } from "@/components/accounts/account-form";
import { Button, EmptyState, ErrorState, IconButton, ListRow, ListSection, Money, Pill, Screen, SkeletonCard, Text } from "@/components/ui";
import { accountFacts, splitArchived, type AccountRow } from "@/src/lib/accounts";
import { orpc } from "@/src/lib/orpc";

export default function AccountsScreen() {
  const router = useRouter();
  const q = useQuery(orpc.accounts.list.queryOptions({ input: { includeArchived: true } }));
  const [adding, setAdding] = useState(false);
  // Stable options: a new object each render makes expo-router call setOptions every time.
  const screenOptions = useMemo(() => ({ headerRight: () => <IconButton name="add" label="Add an account" onPress={() => setAdding(true)} /> }), []);
  const [showArchived, setShowArchived] = useState(false);
  const { active, archived } = splitArchived(q.data?.accounts ?? []);

  const row = (a: AccountRow) => (
    <ListRow
      key={a.id}
      title={a.last4 ? `${a.name} ··${a.last4}` : a.name}
      subtitle={accountFacts(a)}
      right={<Money amount={a.balance.amount} display={a.balance.display} tone={a.balance.amount < 0 ? "destructive" : "default"} variant="label" />}
      onPress={() => router.push({ pathname: "/account/[id]", params: { id: a.id } })}
    />
  );

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={screenOptions} />
      {q.isError && q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      {q.isPending ? (
        <>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </>
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !active.length && !archived.length ? (
        <EmptyState
          icon="wallet-outline"
          title="No accounts yet"
          description="Add each bank account, card and e-wallet, then import its statement. Bank Jago pockets are created for you when you import a Jago statement."
          action={<Button title="Add an account" small icon="add" onPress={() => setAdding(true)} />}
        />
      ) : (
        <>
          {active.length ? <ListSection title="Accounts" footer="Balance = opening balance plus every recorded transaction (pending quick adds too).">{active.map(row)}</ListSection> : null}
          {archived.length ? (
            <>
              <ListSection>
                <ListRow
                  icon={showArchived ? "chevron-up" : "archive-outline"}
                  iconTone="muted"
                  title={showArchived ? "Hide archived" : `Archived (${archived.length})`}
                  subtitle={showArchived ? undefined : "Hidden from pickers and Home"}
                  chevron={false}
                  right={<Pill label={String(archived.length)} />}
                  onPress={() => setShowArchived((v) => !v)}
                  accessibilityLabel={showArchived ? "Hide archived accounts" : `Show ${archived.length} archived accounts`}
                />
              </ListSection>
              {showArchived ? <ListSection title="Archived">{archived.map(row)}</ListSection> : null}
            </>
          ) : null}
          <Button title="Add an account" variant="secondary" icon="add" onPress={() => setAdding(true)} />
          <Text variant="caption" tone="muted">Tap an account to edit it, archive it or see its transactions.</Text>
        </>
      )}
      <AccountFormSheet open={adding} account={null} onClose={() => setAdding(false)} />
    </Screen>
  );
}
