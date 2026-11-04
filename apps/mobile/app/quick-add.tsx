import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";

import { useAccountOptions, useCategoryOptions } from "@/components/data";
import { Button, Card, Field, Screen, Segmented, Select, Text } from "@/components/ui";
import { useApi } from "@/src/lib/auth";

export default function QuickAdd() {
  const api = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const accounts = useAccountOptions();
  const categories = useCategoryOptions();
  const [amountText, setAmountText] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // One id per entry, so a retry after a dropped connection never saves it twice.
  const clientRef = useRef(`app:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`);

  async function save() {
    setError(null);
    if (!amountText.trim()) return setError("Enter an amount, e.g. 25rb or 1,5jt.");
    setBusy(true);
    try {
      const res = await api.quickAdd({
        amountText: amountText.trim(),
        direction,
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        accountId: accountId ?? undefined,
        category: category ?? undefined,
        capturedVia: "manual",
        clientRef: clientRef.current,
      });
      setSaved(`${res.transaction.display} · ${res.transaction.account}${res.transaction.categoryName ? ` · ${res.transaction.categoryName}` : ""}`);
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Screen>
        <Card tone="primary">
          <Text variant="heading">Saved as pending</Text>
          <Text>{saved}</Text>
          <Text variant="caption" tone="muted">The next statement import confirms it.</Text>
        </Card>
        <Button title="Done" onPress={() => router.back()} />
        <Button
          title="Add another"
          variant="secondary"
          onPress={() => {
            clientRef.current = `app:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
            setSaved(null);
            setAmountText("");
            setDescription("");
            setNote("");
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Segmented value={direction} onChange={setDirection} options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
      <Field label="Amount" value={amountText} onChangeText={setAmountText} placeholder="25rb" autoFocus keyboardType="default" autoCapitalize="none" hint='"25rb", "Rp 25.000", "1,5jt"' />
      <Field label="What" value={description} onChangeText={setDescription} placeholder="kopi kenangan" />
      <Select label="Account" value={accountId} options={accounts} onChange={setAccountId} allowClear clearLabel="Most used account" placeholder="Most used account" />
      <Select label="Category" value={category} options={categories} onChange={setCategory} allowClear clearLabel="Let rules decide" placeholder="Let rules decide" />
      <Field label="Note" value={note} onChangeText={setNote} multiline />
      {error ? <Text tone="destructive">{error}</Text> : null}
      <Button title="Save" onPress={save} loading={busy} />
    </Screen>
  );
}
