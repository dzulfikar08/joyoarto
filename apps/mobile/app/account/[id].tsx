// One account: balance, what it covers, its transactions, edit (name, institution, type, opening balance), archive.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert } from "react-native";

import { AccountFormSheet } from "@/components/accounts/account-form";
import { invalidateLedger } from "@/components/data";
import { Button, Card, EmptyState, ErrorState, ListRow, ListSection, Money, Pill, Row, Screen, SkeletonCard, Text } from "@/components/ui";
import { accountSpan, accountTypeLabel, institutionLabel } from "@/src/lib/accounts";
import { errorMessage } from "@/src/lib/errors";
import { plural } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";
import { filtersToParams } from "@/src/lib/transaction-filters";

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery(orpc.accounts.list.queryOptions({ input: { includeArchived: true } }));
  const [editing, setEditing] = useState(false);
  const a = q.data?.accounts.find((x) => x.id === id);
  // Stable options: a new object each render makes expo-router call setOptions every time.
  const name = a?.name;
  const screenOptions = useMemo(() => ({ title: name }), [name]);

  const archive = useMutation({
    mutationFn: (archived: boolean) => client.accounts.update({ id, archived }),
    onSuccess: (_r, archived) => {
      toast.success(archived ? "Account archived" : "Account unarchived");
      invalidateLedger();
    },
    onError: (e) => toast.error("Couldn't update the account", errorMessage(e, { storeSafe })),
  });

  if (q.isPending) {
    return (
      <Screen>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }
  if (!a) {
    return (
      <Screen>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState icon="wallet-outline" title="Account not found" description="It may have been removed on another device." action={<Button title="All accounts" small onPress={() => router.back()} />} />
        )}
      </Screen>
    );
  }

  const confirmArchive = () =>
    Alert.alert(
      a.archived ? `Unarchive ${a.name}?` : `Archive ${a.name}?`,
      a.archived ? "It shows in pickers and on Home again." : "It leaves pickers and Home. Its transactions stay, and you can unarchive it any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: a.archived ? "Unarchive" : "Archive", onPress: () => archive.mutate(!a.archived) },
      ],
    );
  const span = accountSpan(a);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={screenOptions} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="caption" tone="muted">
            {institutionLabel(a.institution)} · {accountTypeLabel(a.type)}
            {a.last4 ? ` · ··${a.last4}` : ""}
          </Text>
          {a.archived ? <Pill label="Archived" /> : null}
        </Row>
        <Money amount={a.balance.amount} display={a.balance.display} variant="hero" tone={a.balance.amount < 0 ? "destructive" : "default"} />
        <Text variant="caption" tone="muted">
          Opening balance {a.openingBalance.display} plus {plural(a.transactions, "recorded transaction")}.
        </Text>
      </Card>

      <ListSection title="Activity">
        <ListRow
          icon="list-outline"
          title="Transactions"
          subtitle={span ?? "None yet"}
          right={<Text variant="label" tone="muted">{a.transactions}</Text>}
          onPress={() => router.navigate({ pathname: "/transactions", params: filtersToParams({ accountId: a.id }) })}
        />
        {a.pending ? (
          <ListRow
            icon="time-outline"
            iconTone="warning"
            title={`${plural(a.pending, "pending quick add")}`}
            subtitle="The next statement import confirms them"
            onPress={() => router.navigate({ pathname: "/transactions", params: filtersToParams({ accountId: a.id, status: "pending" }) })}
          />
        ) : null}
        <ListRow icon="calendar-outline" title="Statements cover" subtitle={a.lastPostedDate ? `Up to ${a.lastPostedDate}` : "No statement imported yet"} />
        <ListRow icon="document-text-outline" title="Import a statement" subtitle="PDF, CSV or by email" onPress={() => router.push({ pathname: "/import", params: { accountId: a.id } })} />
      </ListSection>

      <Row>
        <Button title="Edit" icon="create-outline" variant="secondary" flex onPress={() => setEditing(true)} />
        <Button title={a.archived ? "Unarchive" : "Archive"} icon="archive-outline" variant={a.archived ? "secondary" : "outline"} flex loading={archive.isPending} onPress={confirmArchive} />
      </Row>
      <AccountFormSheet open={editing} account={a} onClose={() => setEditing(false)} />
    </Screen>
  );
}
