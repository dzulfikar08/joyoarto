// Bank Jago and GoPay statement PDFs, one or a whole batch (web: routes/-statement-import.tsx). Each PDF is uploaded
// through the native multipart path and previewed (the server parses and verifies it), then one button saves them all,
// GoPay first, and a combined result says what happened. Shared PDFs (Android share sheet) land here too.

import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useShareIntentContext, type ShareIntentFile } from "expo-share-intent";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";

import { invalidateLedger } from "@/components/data";
import { FormatRequestSheet } from "@/components/import/format-request";
import { Button, Card, Icon, IconButton, Pill, Row, Text } from "@/components/ui";
import { uploadStatement } from "@/src/imports/statement-file";
import type { UploadFile } from "@/src/lib/api";
import { getApi } from "@/src/lib/auth";
import { importsLeft, type BillingStatus } from "@/src/lib/billing";
import { errorMessage, isUnsupportedStatement } from "@/src/lib/errors";
import { plural } from "@/src/lib/format";
import { batchSummary, canSave, ENTRY_STATUS, entryFacts, entryStatus, saveOrder, type BatchEntry, type EntryStatus } from "@/src/lib/imports";
import { storeSafe } from "@/src/lib/platform";
import { useSettings } from "@/src/lib/settings";
import { toast } from "@/src/lib/toast";

type Entry = BatchEntry & { file: UploadFile };

function fromShared(f: ShareIntentFile): UploadFile {
  const uri = f.path.startsWith("file://") || f.path.startsWith("content://") ? f.path : `file://${f.path}`;
  return { uri, name: f.fileName || "statement.pdf", type: f.mimeType || "application/pdf" };
}

let seq = 0;

export function StatementBatch({ billing }: { billing: BillingStatus | undefined }) {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const mock = useSettings().mockStatementFile;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef(entries);
  ref.current = entries;
  const patch = (key: string, p: Partial<Entry>) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const left = importsLeft(billing);

  async function preview(e: Entry) {
    patch(e.key, { busy: "checking", previewError: undefined, unsupported: undefined, preview: undefined, saveError: undefined });
    try {
      patch(e.key, { busy: null, preview: await uploadStatement(await getApi(), e.file, false, mock) });
    } catch (err) {
      patch(e.key, { busy: null, previewError: errorMessage(err, { storeSafe }), unsupported: isUnsupportedStatement(err) });
    }
  }

  function add(files: UploadFile[]) {
    if (!files.length) return;
    const fresh: Entry[] = files.map((file) => ({ key: `s${++seq}`, name: file.name, file, busy: "checking" }));
    // Files saved by an earlier batch are done; the new files start a new batch.
    setEntries((es) => [...es.filter((x) => !x.result?.committed), ...fresh]);
    // One at a time: the server reads each PDF fully.
    void fresh.reduce((p, e) => p.then(() => preview(e)), Promise.resolve());
  }

  useEffect(() => {
    if (!hasShareIntent) return;
    const all = shareIntent.files ?? [];
    const pdfs = all.filter((f) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName));
    if (pdfs.length) {
      setNote(`${plural(pdfs.length, "file")} shared to JoyoArto.`);
      add(pdfs.map(fromShared));
    } else if (all.length || shareIntent.text) setNote("Nothing to import arrived with the share. Share the statement PDF itself.");
    resetShareIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    setNote(null);
    add(res.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/pdf" })));
  }

  async function save() {
    const order = saveOrder(ref.current.filter((e) => canSave(entryStatus(e))));
    if (!order.length) return;
    // Free: a couple of statements a month. The server counts too; this just asks first.
    if (left !== null && order.length > left) {
      Alert.alert(
        left === 0 ? "No statement imports left this month" : `${plural(left, "statement import")} left this month`,
        storeSafe
          ? "This account's plan has a monthly limit on statement imports. Remove some files, or import them next month."
          : `The Free plan imports ${billing?.usage.statementImports.limit ?? 0} statements a month; Joyo Pro is unlimited. Remove some files, or get Joyo Pro in JoyoRogo (Settings → Billing).`,
      );
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;
    for (const e of order) {
      patch(e.key, { busy: "saving", saveError: undefined });
      try {
        const result = await uploadStatement(await getApi(), e.file, true, mock);
        patch(e.key, { busy: null, result });
        if (result.committed) saved++;
        else failed++;
      } catch (err) {
        patch(e.key, { busy: null, saveError: errorMessage(err, { storeSafe }) });
        failed++;
      }
    }
    setSaving(false);
    invalidateLedger();
    if (saved) toast.success(`Imported ${plural(saved, "statement")}`, failed ? `${failed} not saved; see the list.` : undefined);
    else toast.error("Nothing was saved", "See the list.");
  }

  const statuses = entries.map(entryStatus);
  const busy = statuses.some((s) => s === "checking" || s === "saving");
  const ready = statuses.filter(canSave).length;
  const savedEntries = entries.filter((e) => e.result?.committed);
  const notSaved = entries.filter((e) => !e.result?.committed).map((e) => e.name);
  const summary = savedEntries.length && !saving ? batchSummary(savedEntries.map((e) => e.result!), notSaved) : null;

  return (
    <Card title="Statement PDFs" subtitle="Bank Jago monthly statements and GoPay e-statements">
      <Text tone="muted">
        Add every month at once, Jago and GoPay mixed. Each PDF is checked first (every running balance must add up); nothing is saved until you tap Import. Each Jago pocket
        becomes an account, and statements already imported add nothing twice.
      </Text>
      {left !== null && billing ? (
        <Text variant="caption" tone="muted">
          {left} of {billing.usage.statementImports.limit} statement imports left this month.
        </Text>
      ) : null}
      {mock ? <Pill tone="warning" label="Mock uploads (dev setting)" /> : null}
      {note ? <Text variant="caption" tone="muted">{note}</Text> : null}

      {entries.map((e, i) => (
        <EntryCard key={e.key} entry={e} status={statuses[i]!} onRetry={() => void preview(e)} onRemove={saving ? undefined : () => setEntries((es) => es.filter((x) => x.key !== e.key))} />
      ))}

      {entries.length ? (
        <>
          <Button title={ready ? `Import ${plural(ready, "statement")}` : "Import"} icon="cloud-upload-outline" loading={saving} disabled={busy || !ready} onPress={() => void save()} />
          {ready > 1 ? <Text variant="caption" tone="muted">GoPay is saved before Jago, so the Jago payments arrive already named and your rules see the real merchant.</Text> : null}
        </>
      ) : null}

      {summary ? (
        <Card tone="positive" accessibilityLabel={summary.title}>
          <Row style={{ alignItems: "flex-start" }}>
            <Icon name="checkmark-circle" tone="positive" />
            <Text variant="label" style={{ flex: 1 }}>{summary.title}</Text>
          </Row>
          {summary.lines.map((l) => (
            <Text key={l} variant="caption" tone="muted">• {l}</Text>
          ))}
          <Button title="Review transactions" variant="ghost" small onPress={() => router.navigate("/transactions")} />
        </Card>
      ) : null}

      <Row>
        <Button title={entries.length ? "Add PDFs" : "Choose PDFs"} icon="folder-open-outline" variant="secondary" flex disabled={saving} onPress={() => void pick()} />
        {entries.length ? <Button title="Clear" variant="ghost" disabled={saving} onPress={() => setEntries([])} /> : null}
      </Row>
      <Text variant="caption" tone="muted">
        Tip: in the Jago or GoPay app, or in Gmail or Files, share the PDFs to JoyoArto. Password-protected or scanned PDFs can't be read.
      </Text>
    </Card>
  );
}

function EntryCard({ entry: e, status, onRetry, onRemove }: { entry: Entry; status: EntryStatus; onRetry: () => void; onRemove?: () => void }) {
  const [pockets, setPockets] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const r = e.result ?? e.preview;
  const s = ENTRY_STATUS[status];
  return (
    <View style={{ gap: 6 }}>
      <Row>
        <Icon name="document-text-outline" tone="primary" />
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{e.name}</Text>
        <Pill label={s.label} tone={s.tone} />
        {onRemove && status !== "saved" ? <IconButton name="close" size={18} label={`Remove ${e.name}`} onPress={onRemove} /> : null}
      </Row>
      {r ? <Text variant="caption" tone="muted">{[...entryFacts(r), r.period?.from ? `${r.period.from} → ${r.period.to}` : null].filter(Boolean).join(" · ")}</Text> : null}
      {status === "unsupported" ? (
        <View style={{ gap: 6 }}>
          <Text variant="caption" tone="warning">
            We can't read this statement yet: JoyoArto reads Bank Jago monthly statements and GoPay e-statements. Use CSV import below, or ask us to support this bank.
          </Text>
          <Button title="Request support" icon="chatbox-ellipses-outline" small variant="secondary" onPress={() => setRequesting(true)} />
          <FormatRequestSheet open={requesting} onClose={() => setRequesting(false)} file={e.file} />
        </View>
      ) : status === "failed" ? (
        <Row>
          <Text variant="caption" tone="destructive" style={{ flex: 1 }}>{e.previewError}</Text>
          <Button title="Try again" small variant="ghost" onPress={onRetry} />
        </Row>
      ) : status === "save-failed" ? (
        <Text variant="caption" tone="destructive">Not saved: {e.saveError}. Tap Import to try again.</Text>
      ) : status === "problems" && r ? (
        <View style={{ gap: 2 }}>
          {r.problems.slice(0, 5).map((p) => (
            <Text key={p} variant="caption" tone="warning">• {p}</Text>
          ))}
          <Text variant="caption" tone="warning">
            {r.problems.length > 5 ? `…and ${r.problems.length - 5} more. ` : ""}Nothing from this file will be saved.
          </Text>
        </View>
      ) : status === "nothing-new" ? (
        <Text variant="caption" tone="muted">Everything in this statement is already imported.</Text>
      ) : r && (status === "ready" || status === "saved") ? (
        <Text variant="caption" tone="positive">✓ {r.kind === "jago" ? "Every running balance and pocket total matches." : "Totals match the statement."}</Text>
      ) : null}
      {r?.kind === "gopay" && r.bankPaymentsNotImportedYet && !r.committed ? (
        <Text variant="caption" tone="muted">{plural(r.bankPaymentsNotImportedYet, "payment")} from Jago are not imported yet; add that month's Jago statement too.</Text>
      ) : null}
      {r?.kind === "jago" && r.pockets.length ? (
        <>
          <Button title={pockets ? "Hide pockets" : `Pockets (${r.pockets.length})`} variant="ghost" small onPress={() => setPockets((v) => !v)} />
          {pockets
            ? r.pockets.map((p) => (
                <Row key={p.pocket} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text variant="caption" style={{ flex: 1 }}>
                    {p.account}
                    {p.createdAccount ? " (new account)" : ""}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {r.committed ? p.inserted : p.newRows} new · {p.duplicates} in · {p.uncategorized} uncat. · {p.closing}
                  </Text>
                </Row>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}
