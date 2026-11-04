import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useShareIntentContext, type ShareIntentFile } from "expo-share-intent";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Card, Icon, Pill, Row, Screen, Text } from "@/components/ui";
import { uploadStatement, summarize, type StatementSummary } from "@/src/imports/statement-file";
import type { UploadFile } from "@/src/lib/api";
import { getApi } from "@/src/lib/auth";
import { useSettings } from "@/src/lib/settings";

type Entry = {
  key: string;
  file: UploadFile;
  state: "previewing" | "ready" | "importing" | "done" | "error";
  summary?: StatementSummary;
  error?: string;
};

function fromShared(f: ShareIntentFile): UploadFile {
  const uri = f.path.startsWith("file://") || f.path.startsWith("content://") ? f.path : `file://${f.path}`;
  return { uri, name: f.fileName || "statement.pdf", type: f.mimeType || "application/pdf" };
}

export default function ImportScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const settings = useSettings();
  const qc = useQueryClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const mock = settings.mockStatementFile;

  const patch = (key: string, p: Partial<Entry>) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...p } : e)));

  async function preview(entry: Entry) {
    patch(entry.key, { state: "previewing", error: undefined });
    try {
      const r = await uploadStatement(await getApi(), entry.file, false, mock);
      patch(entry.key, { state: "ready", summary: summarize(r) });
    } catch (e) {
      patch(entry.key, { state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  function add(files: UploadFile[]) {
    const fresh = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, state: "previewing" as const }));
    setEntries((es) => [...es, ...fresh]);
    // One at a time: the server parses each PDF fully.
    void fresh.reduce((p, e) => p.then(() => preview(e)), Promise.resolve());
  }

  useEffect(() => {
    if (!hasShareIntent) return;
    const pdfs = (shareIntent.files ?? []).filter((f) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName));
    if (pdfs.length) add(pdfs.map(fromShared));
    resetShareIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    add(res.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/pdf" })));
  }

  async function importAll() {
    for (const e of entries.filter((x) => x.state === "ready" && x.summary?.verified && x.summary.newRows > 0)) {
      patch(e.key, { state: "importing" });
      try {
        const r = await uploadStatement(await getApi(), e.file, true, mock);
        patch(e.key, { state: "done", summary: summarize(r) });
      } catch (err) {
        patch(e.key, { state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    void qc.invalidateQueries();
  }

  const importable = entries.filter((x) => x.state === "ready" && x.summary?.verified && x.summary.newRows > 0).length;

  return (
    <Screen>
      <Text tone="muted">
        Bank Jago monthly statements and GoPay e-statements. Each PDF is checked first (balances must add up); nothing is
        saved until you tap Import. Re-importing a statement adds nothing twice.
      </Text>
      {mock ? <Pill tone="warning" label="Mock uploads (dev setting)" /> : null}
      {entries.map((e) => (
        <Card key={e.key} tone={e.state === "error" ? "destructive" : "default"}>
          <Row style={{ justifyContent: "space-between" }}>
            <Row style={{ flex: 1 }}>
              <Icon name="document-text-outline" tone="primary" />
              <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{e.file.name}</Text>
            </Row>
            <Pill
              label={{ previewing: "Checking…", ready: e.summary?.verified ? "Ready" : "Problem", importing: "Importing…", done: "Imported", error: "Failed" }[e.state]}
              tone={e.state === "done" ? "positive" : e.state === "error" || (e.state === "ready" && !e.summary?.verified) ? "destructive" : e.state === "ready" ? "primary" : "muted"}
            />
          </Row>
          {e.summary ? (
            <View style={{ gap: 4 }}>
              <Text variant="heading">{e.summary.title}</Text>
              {e.summary.period ? <Text tone="muted">{e.summary.period}</Text> : null}
              <Row style={{ flexWrap: "wrap" }}>
                <Pill tone="primary" label={`${e.summary.newRows} new`} />
                <Pill label={`${e.summary.duplicates} already there`} />
                {e.summary.reconciled ? <Pill tone="positive" label={`${e.summary.reconciled} confirm quick adds`} /> : null}
                <Pill tone={e.summary.verified ? "positive" : "destructive"} label={e.summary.verified ? "Balances verified" : "Balances don't add up"} />
              </Row>
              {e.summary.lines.map((l) => (
                <Row key={l.label} style={{ justifyContent: "space-between" }}>
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>{l.label}</Text>
                  <Text variant="caption">{l.value}</Text>
                </Row>
              ))}
              {e.summary.notes.map((n) => <Text key={n} variant="caption" tone="warning">{n}</Text>)}
            </View>
          ) : null}
          {e.error ? <Text tone="destructive">{e.error}</Text> : null}
          {e.state === "error" ? <Button title="Try again" small variant="ghost" onPress={() => void preview(e)} /> : null}
        </Card>
      ))}
      {importable ? <Button title={`Import ${importable} statement${importable > 1 ? "s" : ""}`} onPress={() => void importAll()} /> : null}
      <Button title="Choose PDF…" icon="folder-open-outline" variant="secondary" onPress={() => void pick()} />
    </Screen>
  );
}
