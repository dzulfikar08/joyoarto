// One transaction: what the bank printed (never edited), and what the household can change: category (with "remember
// this merchant"), merchant name, note. Pending quick adds can also fix amount, direction, date, description and
// account, or be deleted (the web's EditPending). Opened from a list row (src/lib/tx-cache.ts hands it over).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Alert, View } from "react-native";

import { invalidateLedger, useAccountGroups, useAccounts } from "@/components/data";
import { CategorySheet } from "@/components/transactions/category-sheet";
import { Button, Card, DateField, EmptyState, Field, FieldLabel, Input, ListRow, ListSection, Money, Pill, Picker, PickerButton, Row, Screen, Segmented, Text } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { amountInputText, dayLabel, formatMoney } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { parseReviewAmount } from "@/src/lib/quick-add";
import { toast } from "@/src/lib/toast";
import { findTransaction, rememberTransaction, type Tx } from "@/src/lib/tx-cache";

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Tx | null>(null);
  // Re-read when the list refetches (after a categorize, the new category name arrives with it).
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => qc.getQueryCache().subscribe(refresh), [qc]);
  const t = local ?? findTransaction(qc, orpc.transactions.key(), id);
  const [categoryOpen, setCategoryOpen] = useState(false);

  if (!t) {
    return (
      <Screen>
        <EmptyState icon="receipt-outline" title="Transaction not loaded" description="Open it from the Transactions list." action={<Button title="Go to Transactions" small onPress={() => router.replace("/transactions")} />} />
      </Screen>
    );
  }
  const update = (fresh: Tx) => {
    rememberTransaction(fresh);
    setLocal(fresh);
    invalidateLedger();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.status === "pending" ? "Pending transaction" : "Transaction" }} />
      <Card>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="heading" numberOfLines={2}>{t.merchant ?? t.description}</Text>
            <Text variant="caption" tone="muted">{dayLabel(t.date)} · {t.account}</Text>
          </View>
          {t.status === "pending" ? <Pill tone="warning" label="pending" /> : null}
        </Row>
        <Money amount={t.amount} display={t.display} currency={t.currency} signed variant="title" />
        {t.status === "pending" ? (
          <Text variant="caption" tone="muted">
            A quick add{t.capturedVia ? ` (${t.capturedVia})` : ""}: the next statement import of this account confirms it.
          </Text>
        ) : null}
      </Card>

      <FieldLabel label="Category" hint={t.categorySource === "rule" ? "Set by a rule" : t.categorySource === "import" ? "Suggested at import" : undefined}>
        <PickerButton label="Category" text={t.categoryName ?? "Uncategorized"} muted={!t.category} onPress={() => setCategoryOpen(true)} />
      </FieldLabel>

      <DetailsForm key={`${t.id}:${t.merchant}:${t.note}`} t={t} onSaved={update} />
      {t.status === "pending" ? <PendingForm key={`p:${t.id}:${t.amount}:${t.date}:${t.description}:${t.accountId}`} t={t} onSaved={update} onDeleted={() => router.back()} /> : null}

      <ListSection title="From the statement">
        <ListRow title="Description" subtitle={t.description} numberOfLines={4} />
        <ListRow title="Date" subtitle={t.date} />
        <ListRow title="Account" subtitle={t.account} />
        {t.capturedAt ? <ListRow title="Captured" subtitle={new Date(t.capturedAt).toLocaleString("id-ID")} /> : null}
      </ListSection>

      <CategorySheet
        tx={categoryOpen ? t : null}
        onClose={() => setCategoryOpen(false)}
        onSaved={() => {
          // The category name comes back with the refetched list.
          setLocal(null);
        }}
      />
    </Screen>
  );
}

/** Merchant (the cleaned-up name) and note: editable on every row. */
function DetailsForm({ t, onSaved }: { t: Tx; onSaved: (t: Tx) => void }) {
  const [merchant, setMerchant] = useState(t.merchant ?? "");
  const [note, setNote] = useState(t.note ?? "");
  const dirty = merchant.trim() !== (t.merchant ?? "") || note.trim() !== (t.note ?? "");
  const save = useMutation({
    mutationFn: () => client.transactions.update({ id: t.id, merchant: merchant.trim() || null, note: note.trim() || null }),
    onSuccess: (fresh) => {
      toast.success("Saved");
      onSaved(fresh);
    },
    onError: (e) => toast.error("Couldn't save", errorMessage(e, { storeSafe })),
  });
  return (
    <>
      <Field label="Merchant" value={merchant} onChangeText={setMerchant} maxLength={80} placeholder={t.description.slice(0, 40)} hint="The name shown in lists; the bank's description stays as it is." />
      <Field label="Note" value={note} onChangeText={setNote} maxLength={500} multiline />
      {dirty ? <Button title="Save changes" loading={save.isPending} onPress={() => save.mutate()} /> : null}
    </>
  );
}

/** Pending rows only: what the quick add captured can still be fixed until the statement confirms it. */
function PendingForm({ t, onSaved, onDeleted }: { t: Tx; onSaved: (t: Tx) => void; onDeleted: () => void }) {
  const accounts = useAccounts();
  const accountGroups = useAccountGroups();
  const [amountText, setAmountText] = useState(amountInputText(t.amount, t.currency));
  const [out, setOut] = useState<"out" | "in">(t.amount < 0 ? "out" : "in");
  const [date, setDate] = useState(t.date);
  const [description, setDescription] = useState(t.description);
  const [accountId, setAccountId] = useState(t.accountId);
  const currency = accounts.data?.accounts.find((a) => a.id === accountId)?.currency ?? t.currency;
  const parsed = useMemo(() => parseReviewAmount(amountText, currency), [amountText, currency]);
  const amount = parsed && parsed !== "invalid" ? (out === "in" ? 1 : -1) * parsed.amount : null;
  const dirty = amount !== t.amount || date !== t.date || description.trim() !== t.description || accountId !== t.accountId;

  const save = useMutation({
    mutationFn: () => client.transactions.update({ id: t.id, ...(amount !== null ? { amount } : {}), date, description: description.trim(), ...(accountId !== t.accountId ? { accountId } : {}) }),
    onSuccess: (fresh) => {
      toast.success("Pending transaction updated");
      onSaved(fresh);
    },
    onError: (e) => toast.error("Couldn't save", errorMessage(e, { storeSafe })),
  });
  const remove = useMutation({
    mutationFn: () => client.transactions.delete({ id: t.id }),
    onSuccess: () => {
      toast.success("Pending transaction deleted");
      invalidateLedger();
      onDeleted();
    },
    onError: (e) => toast.error("Couldn't delete it", errorMessage(e, { storeSafe })),
  });

  return (
    <Card title="Fix the quick add" subtitle="Until the statement confirms it">
      <Segmented
        label="Direction"
        value={out}
        onChange={setOut}
        options={[
          { value: "out", label: "Spent" },
          { value: "in", label: "Received" },
        ]}
      />
      <FieldLabel label="Amount" error={parsed === "invalid" ? "Can't read that amount. Try 25rb, 25.000 or 1,5jt." : null} hint={amount !== null ? formatMoney(amount, currency) : undefined}>
        <Input value={amountText} onChangeText={setAmountText} autoCapitalize="none" accessibilityLabel="Amount" />
      </FieldLabel>
      <DateField label="Date" value={date} onChange={setDate} />
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={500} />
      <Picker label="Account" value={accountId} groups={accountGroups} onChange={(v) => v && setAccountId(v)} searchPlaceholder="Search accounts" />
      {dirty ? <Button title="Save" loading={save.isPending} disabled={amount === null || !description.trim()} onPress={() => save.mutate()} /> : null}
      <Button
        title="Delete"
        variant="destructive"
        loading={remove.isPending}
        onPress={() =>
          Alert.alert("Delete this pending transaction?", `${t.display} · ${t.merchant ?? t.description}`, [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
          ])
        }
      />
    </Card>
  );
}
