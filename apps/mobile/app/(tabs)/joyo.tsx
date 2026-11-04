// Joyo AI, the finance chat (the web's components/joyo/joyo-page.tsx). Conversations are stored on the server per member
// and household; one answer streams at a time (src/lib/joyo-stream.ts: POST /api/joyo/chat as server-sent events,
// because oRPC's own stream decoding needs web streams Hermes lacks). Proposed changes are cards with Confirm/Dismiss;
// confirming runs the stored proposal on the server. The member's own API key is optional (secure store).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Alert, FlatList, Keyboard, Linking, Platform, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { invalidateLedger } from "@/components/data";
import { AssistantTurn, UserBubble } from "@/components/joyo/message";
import { Button, EmptyState, ErrorState, FieldLabel, Icon, IconButton, Input, ListRow, Segmented, Sheet, SkeletonRows, Text, useTabContentInset } from "@/components/ui";
import type { FetchLike } from "@/src/lib/api";
import { currentCredentials } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/errors";
import { availability, BYOK_PROVIDERS, byokInput, chatErrorMessage, maskKey, MAX_CHARS, STARTERS, type ByokProvider, type ByokSettings } from "@/src/lib/joyo";
import { loadByok, saveByok, useByok } from "@/src/lib/joyo-byok";
import { chatReducer, EMPTY_CHAT, streamJoyoChat, type ChatMessage, type Proposal } from "@/src/lib/joyo-stream";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

type Item =
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "pending"; key: string; text: string }
  | { kind: "live"; key: string }
  | { kind: "error"; key: string; message: string; retry: string };

/** Under this many dp from the end, the list follows new text. */
const FOLLOW_PX = 160;

/** Bottom space for the composer: above the floating tab bar, or above the keyboard while it is up. */
function useComposerOffset(): number {
  const tabInset = useTabContentInset();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    // iOS: the window keeps its size and the keyboard covers it. Android: the window shrinks and the tab bar hides.
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setKeyboard(Platform.OS === "ios" ? e.endCoordinates.height - insets.bottom : 1));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);
  if (keyboard > 0) return Platform.OS === "ios" ? keyboard + 8 : 8;
  return Math.max(8, tabInset - 8);
}

export default function JoyoTab() {
  const qc = useQueryClient();
  const { theme } = useUnistyles();
  const status = useQuery(orpc.joyo.status.queryOptions());
  const byok = useByok();
  useEffect(() => {
    void loadByok();
  }, []);
  const [view, dispatch] = useReducer(chatReducer, EMPTY_CHAT);
  const [text, setText] = useState("");
  const [error, setError] = useState<{ message: string; retry: string } | null>(null);
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [away, setAway] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Item>>(null);
  const followRef = useRef(true);
  const bottom = useComposerOffset();

  useEffect(() => () => abortRef.current?.abort(), []);

  const streaming = view.live !== null;
  const avail = availability(status.data, view.usage, byok ?? null, storeSafe);
  const canAsk = avail.kind === "ready";

  const ask = async (question: string) => {
    const q = question.trim().slice(0, MAX_CHARS);
    const creds = currentCredentials();
    if (!q || streaming || !creds) return;
    setError(null);
    setText("");
    followRef.current = true;
    dispatch({ type: "ask", question: q });
    const controller = new AbortController();
    abortRef.current = controller;
    const key = byokInput(byok ?? null);
    try {
      await streamJoyoChat({
        server: creds.server,
        token: creds.token,
        input: { message: q, ...(view.conversationId ? { conversationId: view.conversationId } : {}), ...(key ? { byok: key } : {}) },
        fetchImpl: expoFetch as unknown as FetchLike,
        signal: controller.signal,
        onEvent: (event) => dispatch({ type: "event", event }),
      });
      void qc.invalidateQueries({ queryKey: orpc.joyo.conversations.list.key() });
    } catch (e) {
      if (!controller.signal.aborted) setError({ message: chatErrorMessage(e, errorMessage(e, { storeSafe }), storeSafe), retry: q });
    } finally {
      dispatch({ type: "settled" });
      abortRef.current = null;
      void qc.invalidateQueries({ queryKey: orpc.joyo.status.key() });
    }
  };

  const stop = () => abortRef.current?.abort();

  const act = async (messageId: string, proposal: Proposal, action: "confirm" | "dismiss") => {
    setBusyProposal(proposal.id);
    try {
      const res = await client.joyo.proposal({ messageId, proposalId: proposal.id, action });
      dispatch({ type: "proposal", messageId, proposal: res.proposal });
      if (res.proposal.status === "done") {
        toast.success(res.proposal.result ?? "Done");
        invalidateLedger();
        for (const key of [orpc.plan.key(), orpc.rules.key(), orpc.categories.key()]) void qc.invalidateQueries({ queryKey: key });
      } else if (res.proposal.status === "failed") toast.error(res.proposal.result ?? "Couldn't make this change");
    } catch (e) {
      toast.error(errorMessage(e, { storeSafe }));
    } finally {
      setBusyProposal(null);
    }
  };

  const newChat = () => {
    if (streaming) stop();
    setError(null);
    dispatch({ type: "open", conversationId: undefined, messages: [] });
  };

  const openConversation = async (id: string) => {
    setHistoryOpen(false);
    if (streaming) stop();
    setError(null);
    setOpening(true);
    try {
      const c = await client.joyo.conversations.get({ id });
      followRef.current = true;
      dispatch({ type: "open", conversationId: c.id, messages: c.messages });
    } catch (e) {
      toast.error(errorMessage(e, { storeSafe }));
    } finally {
      setOpening(false);
    }
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = view.messages.map((m) => ({ kind: "message", key: m.id, message: m }));
    if (view.pending) out.push({ kind: "pending", key: "pending", text: view.pending });
    if (view.live) out.push({ kind: "live", key: "live" });
    if (error) out.push({ kind: "error", key: "error", ...error });
    return out;
  }, [view.messages, view.pending, view.live, error]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - (contentOffset.y + layoutMeasurement.height) < FOLLOW_PX;
    followRef.current = near;
    setAway(!near);
  }, []);

  const empty = items.length === 0;
  const title = view.conversationId ? (view.messages.find((m) => m.role === "user")?.content.slice(0, 60) ?? "Joyo AI") : "Joyo AI";
  const subtitle = avail.kind === "ready" ? avail.subtitle : avail.kind === "loading" ? " " : avail.kind === "off" ? "Off on this server" : "Today's questions are used up";

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.kind) {
      case "message":
        return item.message.role === "user" ? (
          <UserBubble text={item.message.content} />
        ) : (
          <AssistantTurn
            text={item.message.content}
            steps={item.message.steps}
            proposals={item.message.proposals}
            busyProposal={busyProposal}
            onProposal={(p, a) => void act(item.message.id, p, a)}
          />
        );
      case "pending":
        return <UserBubble text={item.text} />;
      case "live":
        return view.live ? <AssistantTurn text={view.live.text} steps={view.live.steps} proposals={view.live.proposals} streaming /> : null;
      case "error":
        return (
          <View style={styles.error} accessibilityRole="alert">
            <Text tone="destructive">{item.message}</Text>
            {canAsk ? <Button title="Try again" variant="ghost" small onPress={() => void ask(item.retry)} /> : null}
          </View>
        );
    }
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Icon name="sparkles" size={18} tone="primary" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <IconButton name="key-outline" label="Your API key" onPress={() => setKeyOpen(true)} />
        <IconButton name="time-outline" label="Conversations" onPress={() => setHistoryOpen(true)} />
        <IconButton name="create-outline" label="New chat" onPress={newChat} />
      </View>

      {opening ? (
        <View style={{ padding: 20 }}>
          <SkeletonRows count={4} />
        </View>
      ) : empty ? (
        <FlatList
          data={STARTERS}
          keyExtractor={(s) => s.text}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={{ gap: 6, marginBottom: 8 }}>
              <Text variant="title">Tanya soal uangmu</Text>
              <Text tone="muted">
                Joyo reads your household's ledger to answer: spending, cashflow, budgets, and whether a plan is affordable. It suggests changes; you confirm them.
              </Text>
            </View>
          }
          renderItem={({ item: s }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAsk }}
              disabled={!canAsk}
              onPress={() => void ask(s.text)}
              style={({ pressed }) => [styles.starter, { opacity: !canAsk ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <Text variant="label">{s.text}</Text>
              <Text variant="caption" tone="muted">{s.hint}</Text>
            </Pressable>
          )}
          ListFooterComponent={status.isError && !status.data ? <ErrorState compact error={status.error} onRetry={() => void status.refetch()} /> : undefined}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          extraData={[view.live, busyProposal, canAsk]}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={() => followRef.current && listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <View style={[styles.composerWrap, { paddingBottom: bottom }]}>
        {away && !empty ? (
          <View style={{ alignItems: "center", marginBottom: 6 }}>
            <Button
              title="Latest"
              icon="arrow-down"
              small
              variant="outline"
              onPress={() => {
                followRef.current = true;
                listRef.current?.scrollToEnd({ animated: true });
              }}
            />
          </View>
        ) : null}
        {avail.kind === "off" || avail.kind === "cap" ? (
          <View style={styles.notice}>
            <Text>{avail.message}</Text>
            <Button title="Use your own key" variant="ghost" small icon="key-outline" onPress={() => setKeyOpen(true)} />
          </View>
        ) : (
          <View style={styles.composer}>
            <Input
              value={text}
              onChangeText={(t) => setText(t.slice(0, MAX_CHARS))}
              placeholder="Tanya Joyo… (Berapa pengeluaran makan bulan ini?)"
              accessibilityLabel="Message Joyo AI"
              multiline
              style={styles.input}
              editable={avail.kind === "ready"}
            />
            {streaming ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Stop" onPress={stop} style={[styles.send, styles.stopButton]} hitSlop={6}>
                <Icon name="stop" size={18} tone="primary" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !text.trim() || !canAsk }}
                disabled={!text.trim() || !canAsk}
                onPress={() => void ask(text)}
                style={[styles.send, { opacity: !text.trim() || !canAsk ? 0.4 : 1 }]}
                hitSlop={6}
              >
                <Icon name="arrow-up" size={20} color={theme.colors.primaryForeground} />
              </Pressable>
            )}
          </View>
        )}
        <Text variant="caption" tone="muted" style={styles.disclaimer}>
          Joyo can be wrong. It's not financial advice; check the numbers that matter.
        </Text>
      </View>

      <HistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} current={view.conversationId} onPick={(id) => void openConversation(id)} onDeleted={(id) => id === view.conversationId && newChat()} />
      <KeySheet open={keyOpen} onClose={() => setKeyOpen(false)} settings={byok ?? null} providers={status.data?.byokProviders ?? []} hostedModel={status.data?.hosted?.model ?? null} />
    </SafeAreaView>
  );
}

function HistorySheet({ open, onClose, current, onPick, onDeleted }: { open: boolean; onClose: () => void; current: string | undefined; onPick: (id: string) => void; onDeleted: (id: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ ...orpc.joyo.conversations.list.queryOptions(), enabled: open });
  const remove = (id: string, title: string) =>
    Alert.alert("Delete this conversation?", `"${title}" is deleted for good.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void client.joyo.conversations
            .delete({ id })
            .then(() => {
              onDeleted(id);
              void qc.invalidateQueries({ queryKey: orpc.joyo.conversations.list.key() });
            })
            .catch((e: unknown) => toast.error(errorMessage(e, { storeSafe }))),
      },
    ]);
  const rows = list.data?.conversations ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="Conversations" subtitle="Only you see these. They're kept until you delete them.">
      {list.isPending ? (
        <SkeletonRows count={4} />
      ) : list.isError && !rows.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" title="No conversations yet" description="Ask Joyo something; the conversation is kept here." />
      ) : (
        rows.map((c) => (
          <ListRow
            key={c.id}
            title={c.title}
            subtitle={new Date(c.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            icon={c.id === current ? "chatbubble" : "chatbubble-outline"}
            onPress={() => onPick(c.id)}
            chevron={false}
            right={<IconButton name="trash-outline" label={`Delete "${c.title}"`} tone="muted" onPress={() => remove(c.id, c.title)} />}
          />
        ))
      )}
    </Sheet>
  );
}

type ProviderInfo = { id: ByokProvider; label: string; defaultModel: string; keyUrl: string | null; keyPlaceholder: string };

const PROVIDER_LABEL: Record<ByokProvider, string> = { anthropic: "Anthropic", openrouter: "OpenRouter", openai: "OpenAI" };

function KeySheet({ open, onClose, settings, providers, hostedModel }: { open: boolean; onClose: () => void; settings: ByokSettings | null; providers: readonly ProviderInfo[]; hostedModel: string | null }) {
  const [provider, setProvider] = useState<ByokProvider>(settings?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings?.model ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setProvider(settings?.provider ?? "anthropic");
    setApiKey("");
    setModel(settings?.model ?? "");
  }, [open, settings]);
  const info = providers.find((p) => p.id === provider);
  const save = async (next: ByokSettings | null, message: string) => {
    setSaving(true);
    try {
      await saveByok(next);
      toast.success(message);
      onClose();
    } catch (e) {
      toast.error("Couldn't save the key on this phone", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  // A blank key field keeps the stored key (it is never shown again in full).
  const keyToSave = apiKey.trim() || (settings && settings.provider === provider ? settings.apiKey : "");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your own API key"
      subtitle={hostedModel ? `Optional. Without one, Joyo uses JoyoArto's ${hostedModel} with a daily limit.` : "Joyo AI isn't set up on this server: add your own key to use it."}
    >
      <Segmented label="Provider" value={provider} onChange={setProvider} options={BYOK_PROVIDERS.map((p) => ({ value: p, label: providers.find((x) => x.id === p)?.label ?? PROVIDER_LABEL[p] }))} />
      <FieldLabel label="API key" hint={settings && settings.provider === provider ? `Saved: ${maskKey(settings.apiKey)}. Leave blank to keep it.` : undefined}>
        <Input value={apiKey} onChangeText={setApiKey} placeholder={info?.keyPlaceholder ?? ""} secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel="API key" />
      </FieldLabel>
      {info?.keyUrl && !storeSafe ? <Button title="Get a key" variant="ghost" small icon="open-outline" onPress={() => void Linking.openURL(info.keyUrl!)} /> : null}
      <FieldLabel label="Model (optional)">
        <Input value={model} onChangeText={setModel} placeholder={info?.defaultModel ?? ""} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Model" />
      </FieldLabel>
      <View style={styles.keyNote}>
        <Text variant="caption" tone="muted">
          The key stays on this phone, in its secure storage, and is removed when you sign out. It's sent with each question to JoyoArto's server, which uses it for that call to the
          provider and never stores or logs it. Your question, the conversation and the ledger data Joyo reads go to that provider under its own terms. Not counted in the daily limit.
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {settings ? <Button title="Remove key" variant="secondary" disabled={saving} onPress={() => void save(null, "Key removed")} /> : null}
        <Button
          title="Save"
          flex
          loading={saving}
          disabled={keyToSave.trim().length < 10}
          onPress={() => void save({ provider, apiKey: keyToSave.trim(), model: model.trim(), enabled: true }, "Joyo will use your key")}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: theme.spacing.lg, paddingVertical: 8 },
  headerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center", marginRight: 4 },
  list: { padding: theme.spacing.lg, gap: 18, flexGrow: 1 },
  starter: { backgroundColor: theme.colors.card, borderRadius: theme.radius.tile, paddingHorizontal: 16, paddingVertical: 12, gap: 2, marginBottom: 8 },
  error: { backgroundColor: theme.colors.destructiveSoft, borderRadius: theme.radius.tile, padding: 14, gap: 4, alignItems: "flex-start" },
  composerWrap: { paddingHorizontal: 12, paddingTop: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, backgroundColor: theme.colors.card, borderRadius: 28, borderWidth: 1, borderColor: theme.colors.border, padding: 6, paddingLeft: 14 },
  input: { flex: 1, borderWidth: 0, backgroundColor: "transparent", minHeight: 44, maxHeight: 140, paddingHorizontal: 0, paddingVertical: 10 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  stopButton: { backgroundColor: theme.colors.primarySoft },
  notice: { backgroundColor: theme.colors.card, borderRadius: 24, borderWidth: 1, borderColor: theme.colors.border, padding: 14, gap: 4, alignItems: "flex-start" },
  disclaimer: { textAlign: "center", marginTop: 4 },
  keyNote: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile, padding: 12 },
}));
