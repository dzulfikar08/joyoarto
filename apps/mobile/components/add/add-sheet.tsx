// The add-transaction sheet behind the tab bar's centre button (the web's apps/web/src/components/add-sheet.tsx):
// type it ("kopi 25rb gopay"), the server reads it (capture.parse: AI with a rules fallback), review the editable draft,
// Save = transactions.quickAdd as a pending row. Nothing is saved before Save. Voice ("Say it", when the server has
// transcription on: joyo.status.voice): src/lib/voice.ts records up to 60 s, the server turns it into text, and the
// text runs through the same parse → review → save.

import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { invalidateLedger, useAccountGroups, useAccounts, useCategoryGroups } from "@/components/data";
import { Button, DateField, Field, FieldLabel, Icon, Input, Loading, Picker, Row, Segmented, Sheet, Text } from "@/components/ui";
import { closeAddSheet, useAddSheet } from "@/src/lib/add-sheet";
import { errorMessage } from "@/src/lib/errors";
import { formatMoney } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { lastAccountId, loadPrefs, rememberAccount } from "@/src/lib/prefs";
import { emptyReview, parseReviewAmount, quickAddPayload, reviewFromDraft, type Review } from "@/src/lib/quick-add";
import { toast } from "@/src/lib/toast";
import { useVoiceCapture } from "@/src/lib/voice";
import { clockLabel, MAX_RECORD_MS, VOICE_MESSAGES, voiceNotice } from "@/src/lib/voice-state";

const EXAMPLES = ["kopi kenangan 25rb gopay", "gaji masuk 16 juta", "kemarin parkir 5rb cash"];

type Phase = "input" | "reading" | "review";

export function AddSheet() {
  const { open, prefill, session } = useAddSheet();
  useEffect(() => {
    void loadPrefs();
  }, []);
  return (
    <Sheet open={open} onClose={closeAddSheet} title="Add transaction" subtitle="Say it or type it. You check it before it's saved.">
      {open ? <AddFlow key={session} prefill={prefill} onDone={closeAddSheet} /> : null}
    </Sheet>
  );
}

function AddFlow({ prefill, onDone }: { prefill?: string; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState(prefill ?? "");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review>(() => emptyReview(lastAccountId()));
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const parse = async (input: string, via: Review["via"], heard: string | null) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase("reading");
    try {
      const res = await client.capture.parse({ text: input }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setReview(reviewFromDraft(res.draft, via, heard, lastAccountId()));
      setPhase("review");
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(errorMessage(e, { storeSafe }));
      setPhase("input");
    }
  };

  const status = useQuery({ ...orpc.joyo.status.queryOptions(), staleTime: 5 * 60_000 });
  const voiceOn = status.data?.voice === true;
  const voice = useVoiceCapture((heard) => {
    setText(heard);
    void parse(heard, "voice", heard);
  });
  const vs = voice.state;

  const submitText = () => {
    const t = text.trim();
    if (t.length < 2) return;
    void parse(t, "manual", null);
  };

  if (phase === "review") return <ReviewForm review={review} setReview={setReview} onBack={() => setPhase("input")} onDone={onDone} />;

  if (vs.phase === "recording" || vs.phase === "stopping") {
    const elapsed = vs.elapsedMs;
    return (
      <View style={{ alignItems: "center", gap: 14 }} accessibilityLiveRegion="polite">
        <View style={styles.recIcon}>
          <Icon name="mic" color="#fff" size={34} />
        </View>
        <Text variant="heading">Listening…</Text>
        <Text tone="muted" accessibilityLabel={`${Math.floor(elapsed / 1000)} of 60 seconds`}>
          {clockLabel(elapsed)} / {clockLabel(MAX_RECORD_MS)}
        </Text>
        <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
          Say what it was, how much and how you paid. “Bayar parkir lima ribu cash”
        </Text>
        <Row>
          <Button title="Cancel" variant="secondary" flex onPress={voice.cancel} />
          <Button title="Done" icon="stop" flex loading={vs.phase === "stopping"} onPress={voice.stop} />
        </Row>
      </View>
    );
  }

  if (vs.phase === "sending" || vs.phase === "asking") {
    return (
      <View style={{ alignItems: "center", gap: 8 }}>
        <Loading label={vs.phase === "asking" ? "Waiting for microphone access…" : "Turning your voice note into text…"} />
        {vs.phase === "asking" ? <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>{VOICE_MESSAGES.why}</Text> : null}
        <Button title="Cancel" variant="ghost" small onPress={voice.cancel} />
      </View>
    );
  }

  if (phase === "reading") {
    return (
      <View style={{ alignItems: "center", gap: 8 }}>
        <Loading label="Reading it…" />
        {text ? <Text tone="muted" style={{ textAlign: "center" }}>“{text}”</Text> : null}
        <Button
          title="Cancel"
          variant="ghost"
          small
          onPress={() => {
            abortRef.current?.abort();
            setPhase("input");
          }}
        />
      </View>
    );
  }

  return (
    <>
      {voiceOn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Say it: record a voice note, up to 60 seconds"
          onPress={() => {
            setError(null);
            voice.start();
          }}
          style={styles.voice}
        >
          <View style={styles.voiceIcon}>
            <Icon name="mic" color="#fff" size={24} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading" tone="primary">Say it</Text>
            <Text variant="caption" tone="primary">“Gaji masuk 16 juta”, “bayar parkir lima ribu cash”</Text>
          </View>
        </Pressable>
      ) : null}
      {voiceOn && voiceNotice(vs) ? (
        <View style={styles.note} accessibilityRole="alert">
          <Text variant="caption" tone={vs.phase === "denied" ? "warning" : "destructive"}>{voiceNotice(vs)}</Text>
          {vs.phase === "denied" ? (
            <Row style={{ marginTop: 6 }}>
              {vs.canAskAgain ? <Button title="Allow microphone" small variant="secondary" icon="mic-outline" onPress={voice.start} /> : <Button title="Open Settings" small variant="secondary" icon="settings-outline" onPress={() => void Linking.openSettings()} />}
              <Button title="Type instead" small variant="ghost" onPress={voice.reset} />
            </Row>
          ) : null}
        </View>
      ) : null}
      <FieldLabel label={voiceOn ? "Or type it" : "Type it"} error={error}>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="kopi 25rb gopay"
          maxLength={500}
          multiline
          autoFocus={!prefill && !voiceOn}
          blurOnSubmit
          returnKeyType="go"
          onSubmitEditing={submitText}
          autoCapitalize="none"
          accessibilityLabel="What did you spend or receive?"
        />
      </FieldLabel>
      <Row style={{ flexWrap: "wrap" }} gap={6}>
        {EXAMPLES.map((ex) => (
          <Pressable key={ex} onPress={() => setText(ex)} style={styles.example} accessibilityRole="button" accessibilityLabel={`Example: ${ex}`}>
            <Text variant="caption" tone="muted">{ex}</Text>
          </Pressable>
        ))}
      </Row>
      <Button title="Continue" onPress={submitText} disabled={text.trim().length < 2} />
      <Button
        title="Fill in by hand"
        variant="ghost"
        onPress={() => {
          setReview(emptyReview(lastAccountId()));
          setPhase("review");
        }}
      />
    </>
  );
}

function ReviewForm({ review, setReview, onBack, onDone }: { review: Review; setReview: (r: Review) => void; onBack: () => void; onDone: () => void }) {
  const accounts = useAccounts();
  const accountGroups = useAccountGroups();
  const categoryGroups = useCategoryGroups();
  const clientRef = useRef(`app:${Crypto.randomUUID()}`);
  const list = accounts.data?.accounts ?? [];
  const currency = list.find((a) => a.id === review.accountId)?.currency ?? "IDR";
  const set = (patch: Partial<Review>) => setReview({ ...review, ...patch });
  const parsed = useMemo(() => parseReviewAmount(review.amountText, currency), [review.amountText, currency]);
  const payload = quickAddPayload(review, clientRef.current, currency);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof client.transactions.quickAdd>[0]) => client.transactions.quickAdd(input),
    onSuccess: (res) => {
      const t = res.transaction;
      if (review.accountId) rememberAccount(review.accountId);
      toast.success(res.created ? "Added as pending" : "Already added", `${t.display} · ${t.merchant ?? t.description} · ${t.account}`);
      invalidateLedger();
      onDone();
    },
  });

  if (accounts.isSuccess && !list.length) {
    return <Text tone="muted">Add an account first (More → Accounts, or import a statement), then come back.</Text>;
  }

  return (
    <>
      {review.heard ? (
        <View style={styles.note}>
          <Text variant="caption" tone="muted">Heard: <Text variant="caption">“{review.heard}”</Text></Text>
        </View>
      ) : null}
      {review.source === "rules" && !review.heard ? <Text variant="caption" tone="muted">Read without AI. Check every field.</Text> : null}
      <Segmented
        label="Direction"
        value={review.direction}
        onChange={(direction) => set({ direction })}
        options={[
          { value: "out", label: "Spent" },
          { value: "in", label: "Received" },
        ]}
      />
      <FieldLabel
        label="Amount"
        error={parsed === "invalid" ? "Can't read that amount. Try 25rb, 25.000 or 1,5jt." : null}
        hint={parsed && parsed !== "invalid" ? formatMoney((review.direction === "in" ? 1 : -1) * parsed.amount, currency) : "e.g. 25rb, 25.000, 1,5jt"}
      >
        <Input value={review.amountText} onChangeText={(amountText) => set({ amountText })} placeholder="25.000" keyboardType="default" autoCapitalize="none" style={styles.amount} accessibilityLabel="Amount" />
      </FieldLabel>
      <Field label="What was it?" value={review.description} maxLength={500} onChangeText={(description) => set({ description })} placeholder="Kopi Kenangan" />
      <Picker label="Account" value={review.accountId} groups={accountGroups} onChange={(v) => set({ accountId: v ?? "" })} none="Most used account" searchPlaceholder="Search accounts" />
      <Picker label="Category" value={review.category} groups={categoryGroups} onChange={(v) => set({ category: v ?? "" })} none="Let rules decide" searchPlaceholder="Search categories" />
      <DateField label="Date" value={review.date} onChange={(date) => set({ date })} />
      <Field label="Merchant" hint="Optional" value={review.merchant} maxLength={80} onChangeText={(merchant) => set({ merchant })} />
      <Field label="Note" hint="Optional" value={review.note} maxLength={500} onChangeText={(note) => set({ note })} />
      <Text variant="caption" tone="muted">Saved as pending: the next statement import of that account confirms it.</Text>
      {save.error ? <Text tone="destructive">{errorMessage(save.error, { storeSafe })}</Text> : null}
      <Row>
        <Button title="Back" variant="secondary" icon="arrow-back" onPress={onBack} />
        <Button title={save.isPending ? "Saving…" : "Save"} flex loading={save.isPending} disabled={!payload.ok} onPress={() => payload.ok && save.mutate(payload.input)} />
      </Row>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  voice: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: theme.colors.primarySoft, borderRadius: 24, padding: 14 },
  recIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.destructive, alignItems: "center", justifyContent: "center" },
  voiceIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  example: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  note: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile, padding: 12 },
  amount: { fontFamily: theme.fonts.bold, fontSize: theme.fontSize.xl },
}));
