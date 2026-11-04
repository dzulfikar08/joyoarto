import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useAccountOptions, useCategoryOptions } from "@/components/data";
import { Button, Card, Field, Pill, Row, Screen, Segmented, Select, Text } from "@/components/ui";
import { amountLabel, SOURCE, STATUS } from "@/src/capture/labels";
import { useCaptures } from "@/src/capture/store";
import { editCapture, fixSentCapture, ignoreCapture, sendNow } from "@/src/capture/sync";

export default function CaptureDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const item = useCaptures().find((i) => i.id === id);
  const accounts = useAccountOptions();
  const categories = useCategoryOptions();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [amountText, setAmountText] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAccountId(item.edits.accountId ?? null);
    setCategory(item.edits.category ?? item.sentCategory ?? null);
    setMerchant(item.edits.merchant ?? item.parsed?.counterparty ?? "");
    setAmountText(item.edits.amountText ?? item.parsed?.amountText ?? "");
    setDirection(item.edits.direction ?? item.parsed?.direction ?? "out");
    setNote(item.edits.note ?? "");
    // Only when another capture is opened; edits in progress are not overwritten by status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return <Screen><Text tone="muted">This capture is gone.</Text></Screen>;
  const sent = item.status === "sent";
  const edits = {
    accountId: accountId ?? undefined,
    category: category ?? undefined,
    merchant: merchant.trim() || undefined,
    note: note.trim() || undefined,
    ...(sent ? {} : { amountText: amountText.trim() || undefined, direction }),
  };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="title">{amountLabel(item)}</Text>
          <Pill label={STATUS[item.status].label} tone={STATUS[item.status].tone} />
        </Row>
        <Text tone="muted">
          {SOURCE[item.source]} · {new Date(item.postedAt).toLocaleString("id-ID")}
          {item.sentAccount ? ` · ${item.sentAccount}` : ""}
        </Text>
        {item.parsed?.confidence === "low" ? (
          <Text tone="warning">Not sure about this one ({item.parsed.doubts.join(", ")}). Check it before sending.</Text>
        ) : null}
        {item.status === "ignored" ? <Text tone="muted">Ignored: {item.ignoredReason}</Text> : null}
        {item.status === "failed" ? (
          <Text tone="destructive">{item.lastError}{item.retryAt ? ` · retrying ${new Date(item.retryAt).toLocaleTimeString("id-ID")}` : ""}</Text>
        ) : null}
        {sent ? <Text variant="caption" tone="muted">Saved as a pending transaction; the next statement import confirms it.</Text> : null}
      </Card>

      {!sent ? (
        <>
          <Segmented value={direction} onChange={setDirection} options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
          <Field label="Amount" value={amountText} onChangeText={setAmountText} autoCapitalize="none" />
        </>
      ) : null}
      <Field label="Merchant / name" value={merchant} onChangeText={setMerchant} />
      <Select label="Account" value={accountId} options={accounts} onChange={setAccountId} allowClear clearLabel="Most used account" placeholder={item.sentAccount ?? "Most used account"} />
      <Select label="Category" value={category} options={categories} onChange={setCategory} allowClear clearLabel="Let rules decide" placeholder="Let rules decide" />
      <Field label="Note" value={note} onChangeText={setNote} />
      {error ? <Text tone="destructive">{error}</Text> : null}

      {sent ? (
        <Button title="Save changes" loading={busy} onPress={() => run(() => fixSentCapture(item.id, edits))} />
      ) : (
        <>
          <Button
            title={item.status === "failed" ? "Retry now" : "Send"}
            icon="send"
            loading={busy}
            onPress={() => run(async () => {
              await editCapture(item.id, edits);
              await sendNow(item.id);
            })}
          />
          <Row>
            <View style={{ flex: 1 }}><Button title="Save without sending" variant="secondary" onPress={() => run(() => editCapture(item.id, edits))} /></View>
            {item.status !== "ignored" ? (
              <View style={{ flex: 1 }}><Button title="Ignore" variant="ghost" onPress={() => run(async () => { await ignoreCapture(item.id); router.back(); })} /></View>
            ) : null}
          </Row>
        </>
      )}

      <Button title={showText ? "Hide notification text" : "Show notification text"} variant="ghost" small onPress={() => setShowText(!showText)} />
      {showText ? (
        <Card>
          <Text variant="caption" tone="muted">Kept on this phone only; never uploaded.</Text>
          <Text variant="label">{item.title}</Text>
          <Text>{item.text}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
