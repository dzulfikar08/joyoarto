// "Request support" for a statement PDF JoyoArto can't read yet (web: components/format-request.tsx). The server masks
// the PDF (every digit 9, names and merchants XXXX) and shows exactly that; only Send files the request.

import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Icon, Row, Sheet, Text } from "@/components/ui";
import type { FormatPreview, UploadFile } from "@/src/lib/api";
import { getApi } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/errors";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

type State = { step: "loading" } | { step: "error"; message: string } | { step: "ready"; preview: FormatPreview } | { step: "sending"; preview: FormatPreview } | { step: "sent"; already: boolean; bank: string | null };

export function FormatRequestSheet({ open, onClose, file }: { open: boolean; onClose: () => void; file: UploadFile }) {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ step: "loading" });
    void (async () => {
      try {
        const api = await getApi();
        if (!api) throw new Error("Sign in again to send requests.");
        const preview = await api.formatPreviewFile(file);
        if (live) setState({ step: "ready", preview });
      } catch (e) {
        if (live) setState({ step: "error", message: errorMessage(e, { storeSafe }) });
      }
    })();
    return () => {
      live = false;
    };
  }, [open, file]);

  async function send(preview: FormatPreview) {
    setState({ step: "sending", preview });
    try {
      const api = await getApi();
      if (!api) throw new Error("Sign in again to send requests.");
      const res = await api.requestFormatFile(file, Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other");
      setState({ step: "sent", already: res.alreadyRequested, bank: preview.bank });
      if (!res.alreadyRequested) toast.success("Request sent", "Thanks! We'll let you know when this bank is supported.");
    } catch (e) {
      setState({ step: "ready", preview });
      toast.error("Not sent", errorMessage(e, { storeSafe }));
    }
  }

  const preview = state.step === "ready" || state.step === "sending" ? state.preview : null;
  const blocked = !preview || !preview.available || preview.alreadyRequested || preview.requestsLeftToday === 0;
  const footer =
    state.step === "sent" ? (
      <Button title="Done" variant="secondary" onPress={onClose} />
    ) : preview ? (
      <Button title="Send request" icon="paper-plane-outline" loading={state.step === "sending"} disabled={blocked} onPress={() => void send(preview)} />
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} title="Request support" subtitle={`We can't read ${file.name} yet`} footer={footer}>
      {state.step === "loading" ? <Text tone="muted">Masking the statement…</Text> : null}
      {state.step === "error" ? <Text tone="destructive">{state.message}</Text> : null}
      {state.step === "sent" ? (
        <View style={styles.gap}>
          <Row style={{ alignItems: "flex-start" }}>
            <Icon name="checkmark-circle" tone="positive" />
            <Text variant="label" style={{ flex: 1 }}>{state.already ? "You asked for this format already." : "Thanks, request sent."}</Text>
          </Row>
          <Text tone="muted">
            We'll let you know when JoyoArto reads {state.bank ?? "this bank"}'s statements. Until then, use CSV import.
          </Text>
        </View>
      ) : null}
      {preview ? (
        <View style={styles.gap}>
          <Row style={{ alignItems: "flex-start" }}>
            <Icon name="shield-checkmark-outline" tone="positive" />
            <Text variant="label" style={{ flex: 1 }}>What is sent</Text>
          </Row>
          <Text variant="caption" tone="muted">• Only the masked text below: every digit is 9, and every name, merchant and note is replaced by XXXX or Xxxx.</Text>
          <Text variant="caption" tone="muted">• Column labels, the shapes of dates and amounts, and bank words (Saldo, Mutasi, DB/CR) stay, so we can write a reader.</Text>
          <Text variant="caption" tone="muted">• Not sent: the PDF, your name, email, accounts or household. An AI writes notes for us from this masked text only.</Text>
          <Text variant="caption" tone="muted">
            Exactly what is sent{preview.bank ? ` (looks like ${preview.bank})` : ""}, {preview.lines} lines{preview.pages ? `, ${preview.pages} pages` : ""}:
          </Text>
          <ScrollView style={styles.box} nestedScrollEnabled accessibilityLabel="Masked statement text">
            <ScrollView horizontal nestedScrollEnabled>
              <Text style={styles.mono} selectable>{preview.skeleton}</Text>
            </ScrollView>
          </ScrollView>
          {!preview.available ? <Text tone="muted">Requests are not available on this server.</Text> : null}
          {preview.available && preview.alreadyRequested ? <Text tone="muted">You asked for this format already. We'll let you know when it's supported.</Text> : null}
          {preview.available && !preview.alreadyRequested && preview.requestsLeftToday === 0 ? <Text tone="muted">That's all the requests for today. Try again tomorrow.</Text> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  gap: { gap: theme.spacing.sm },
  box: {
    maxHeight: 280,
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 11, lineHeight: 15, color: theme.colors.foreground },
}));
