// CSV or spreadsheet export from any bank (web: routes/import.tsx): pick the account and the file, map the columns
// (start from a preset like BCA or a saved mapping), preview with the running-balance check, then import and
// optionally save the mapping for next time.

import { parseCsv } from "@baroka/api/lib/csv";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { invalidateLedger, useAccountGroups, useAccounts } from "@/components/data";
import { Button, Card, Divider, Field, FieldLabel, Pill, Picker, Row, Segmented, SwitchRow, Text } from "@/components/ui";
import {
  applyStart,
  columnOptions,
  DATE_FORMATS,
  formProblem,
  headerRowOptions,
  initialForm,
  isCsvName,
  presetFor,
  startOptions,
  toggleDescription,
  toMapping,
  type CsvForm,
  type DateFormat,
} from "@/src/lib/csv-form";
import { errorMessage } from "@/src/lib/errors";
import { plural } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

const PREVIEW_ROWS = 60;
const one = <T,>(options: T[]) => [{ label: null, options }];

export function CsvImport({ initialAccountId }: { initialAccountId?: string }) {
  const router = useRouter();
  const accounts = useAccounts();
  const accountGroups = useAccountGroups();
  const mappings = useQuery(orpc.imports.mappings.queryOptions());
  const [accountId, setAccountId] = useState<string | null>(initialAccountId ?? null);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [form, setForm] = useState<CsvForm | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState("");
  const [raw, setRaw] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const account = accounts.data?.accounts.find((a) => a.id === accountId);
  const saved = mappings.data?.saved ?? [];
  const set = (p: Partial<CsvForm>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    preview.reset();
  };
  const header = useMemo(() => (table && form ? (table[form.headerRow] ?? []) : []), [table, form]);
  const cols = useMemo(() => one(columnOptions(header)), [header]);

  const run = (commit: boolean) =>
    client.imports.csv({ accountId: accountId!, table: table!, mapping: toMapping(form!), commit, fileName, ...(commit && saveAs.trim() ? { saveMappingAs: saveAs.trim() } : {}) });
  const preview = useMutation({ mutationFn: () => run(false) });
  const commit = useMutation({
    mutationFn: () => run(true),
    onSuccess: (r) => {
      toast.success(`Saved ${plural(r.inserted, "transaction")}`);
      invalidateLedger();
      void mappings.refetch();
    },
    onError: (e) => toast.error("Couldn't import", errorMessage(e, { storeSafe })),
  });

  async function pick() {
    setReadError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["text/*", "text/csv", "text/comma-separated-values", "application/csv", "application/vnd.ms-excel", "application/octet-stream"], copyToCacheDirectory: true });
    if (res.canceled) return;
    const file = res.assets[0]!;
    if (!isCsvName(file.name)) {
      setReadError("Pick a .csv, .tsv or .txt export. Jago and GoPay PDFs go in Statement PDFs above; for other PDFs or Excel files, save them as CSV first.");
      return;
    }
    try {
      const parsed = parseCsv(await FileSystem.readAsStringAsync(file.uri));
      if (!parsed.length) throw new Error("empty");
      setTable(parsed);
      setFileName(file.name);
      setForm(initialForm(parsed, presetFor(account?.institution)));
      setStart(account && presetFor(account.institution) ? `preset:${account.institution}` : null);
      preview.reset();
      commit.reset();
    } catch {
      setReadError("Could not read that file. Is it a CSV export (text, not a spreadsheet)?");
    }
  }

  const problem = form ? formProblem(form) : null;
  const result = commit.data ?? preview.data;

  return (
    <>
      <Card title="CSV or spreadsheet export" subtitle="Any bank: map the columns, preview, then import">
        <Picker
          label="Account"
          value={accountId}
          groups={accountGroups}
          onChange={(v) => {
            setAccountId(v);
            preview.reset();
            commit.reset();
          }}
          placeholder="Choose the account it belongs to"
          searchPlaceholder="Search accounts"
        />
        {accounts.data && !accounts.data.accounts.length ? <Button title="Add an account first" variant="ghost" small onPress={() => router.push("/accounts")} /> : null}
        <Button title={fileName ? `Change file (${fileName})` : "Choose CSV file"} icon="document-outline" variant="secondary" disabled={!accountId} onPress={() => void pick()} />
        {!accountId ? <Text variant="caption" tone="muted">Choose the account first.</Text> : null}
        {readError ? <Text variant="caption" tone="destructive">{readError}</Text> : null}
      </Card>

      {table && form ? (
        <Card title="Map the columns" subtitle={`${fileName}: which column holds what. Preview reads the file with these settings; nothing is saved yet.`}>
          <Picker
            label="Start from"
            value={start}
            groups={one(startOptions(saved))}
            onChange={(v) => {
              if (!v) return;
              setStart(v);
              setForm(applyStart(table, form, v, saved));
              preview.reset();
            }}
            placeholder="A preset or saved mapping…"
            searchPlaceholder="Search mappings"
          />
          <Button title={raw ? "Hide the raw file" : "Show the raw file (first rows)"} variant="ghost" small onPress={() => setRaw((v) => !v)} />
          {raw ? <RawRows table={table} headerRow={form.headerRow} /> : null}

          <Section title="Rows and dates">
            <Picker label="Header row" hint="The row with the column names; rows above it are skipped." value={String(form.headerRow)} groups={one(headerRowOptions(table))} onChange={(v) => v && set({ headerRow: Number(v) })} />
            <Picker label="Date column" value={String(form.date)} groups={cols} onChange={(v) => v && set({ date: Number(v) })} searchPlaceholder="Search columns" />
            <Picker label="Date format" value={form.dateFormat} groups={one(DATE_FORMATS.map((d) => ({ value: d, label: d })))} onChange={(v) => v && set({ dateFormat: v as DateFormat })} />
            {form.dateFormat === "DD/MM" ? <Field label="Year" keyboardType="number-pad" maxLength={4} value={form.year} onChangeText={(year) => set({ year })} hint="The file's dates have no year." /> : null}
          </Section>

          <Section title="Description">
            <Text variant="caption" tone="muted">Pick every column that describes the transaction; they are joined in this order.</Text>
            <Row style={{ flexWrap: "wrap" }}>
              {header.map((h, i) => (
                <Pill key={i} label={h.trim() || `Column ${i + 1}`} selected={form.description.includes(i)} icon={form.description.includes(i) ? "checkmark" : undefined} onPress={() => set({ description: toggleDescription(form, i).description })} />
              ))}
            </Row>
          </Section>

          <Section title="Amounts">
            <Segmented<CsvForm["mode"]>
              label="Amount columns"
              value={form.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: "single", label: "One column" },
                { value: "split", label: "Debit + credit" },
              ]}
            />
            {form.mode === "single" ? (
              <>
                <Picker label="Amount" value={String(form.amount)} groups={cols} onChange={(v) => v && set({ amount: Number(v) })} searchPlaceholder="Search columns" />
                <Picker label="DB/CR column" value={form.marker === null ? null : String(form.marker)} groups={cols} none="None (sign or DB/CR in amount)" onChange={(v) => set({ marker: v === null ? null : Number(v) })} />
                <SwitchRow label="Flip signs" hint="For card statements that list spending as positive." value={form.invert} onValueChange={(invert) => set({ invert })} />
              </>
            ) : (
              <>
                <Picker label="Debit (out)" value={String(form.debit)} groups={cols} onChange={(v) => v && set({ debit: Number(v) })} searchPlaceholder="Search columns" />
                <Picker label="Credit (in)" value={String(form.credit)} groups={cols} onChange={(v) => v && set({ credit: Number(v) })} searchPlaceholder="Search columns" />
              </>
            )}
            <Picker label="Balance" hint="Lets the preview check every running balance." value={form.balance === null ? null : String(form.balance)} groups={cols} none="None" onChange={(v) => set({ balance: v === null ? null : Number(v) })} />
            <FieldLabel label="Decimal mark">
              <Segmented<CsvForm["decimal"]>
                label="Decimal mark"
                value={form.decimal}
                onChange={(decimal) => set({ decimal })}
                options={[
                  { value: "", label: "Guess" },
                  { value: "dot", label: "1,250.00" },
                  { value: "comma", label: "1.250,00" },
                ]}
              />
            </FieldLabel>
          </Section>

          <Divider />
          <Button title="Preview" icon="eye-outline" loading={preview.isPending} disabled={!!problem} onPress={() => preview.mutate()} />
          {problem ? <Text variant="caption" tone="muted">{problem}</Text> : null}
          {preview.isError ? <Text variant="caption" tone="destructive">{errorMessage(preview.error, { storeSafe })}</Text> : null}
        </Card>
      ) : null}

      {result ? (
        <Card title={result.committed ? `Saved ${plural(result.inserted, "transaction")}` : "Preview"} tone={result.committed ? "positive" : "default"}>
          <Row style={{ flexWrap: "wrap" }}>
            <Pill tone="primary" label={`${result.newRows} new`} />
            <Pill label={`${result.duplicates} already imported`} />
            <Pill label={`${result.uncategorized} uncategorized`} />
          </Row>
          <Text variant="caption" tone="muted">
            {result.period.from} → {result.period.to} · in {result.moneyIn.display} · out {result.moneyOut.display}
          </Text>
          {result.balanceCheck.checked > 0 ? (
            result.balanceCheck.mismatches.length ? (
              <Text variant="caption" tone="warning">
                The running balance does not add up on {plural(result.balanceCheck.mismatches.length, "row")} (first: row {result.balanceCheck.mismatches[0]!.row + 1}). A sign or column is probably mapped wrong: check the amount settings.
              </Text>
            ) : (
              <Text variant="caption" tone="positive">✓ Amounts match the statement's running balance ({result.balanceCheck.checked} rows checked).</Text>
            )
          ) : null}
          {result.parseErrors?.length ? <ParseErrors errors={result.parseErrors} /> : null}

          {result.committed ? (
            <Button title="Review them" variant="secondary" small onPress={() => router.navigate("/transactions")} />
          ) : (
            <>
              <View style={{ gap: 2 }}>
                {result.preview.slice(0, PREVIEW_ROWS).map((r) => (
                  <View key={r.row} style={{ flexDirection: "row", gap: 8, paddingVertical: 6 }}>
                    <Text variant="caption" tone="muted" style={{ width: 78, fontVariant: ["tabular-nums"] }}>{r.date}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="label" numberOfLines={1}>{r.merchant ?? r.description}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>{[r.category, r.merchant ? r.description : null].filter(Boolean).join(" · ")}</Text>
                    </View>
                    <Text variant="label" tone={r.amount < 0 ? "default" : "positive"} style={{ fontVariant: ["tabular-nums"] }}>{r.display}</Text>
                  </View>
                ))}
                {result.preview.length > PREVIEW_ROWS ? <Text variant="caption" tone="muted">…and {result.preview.length - PREVIEW_ROWS} more rows.</Text> : null}
              </View>
              <Field label="Save mapping as" placeholder="e.g. BCA CSV" maxLength={80} value={saveAs} onChangeText={setSaveAs} hint="Optional: reuse it next time from “Start from”." />
              <Button title={`Import ${plural(result.newRows, "transaction")}`} icon="cloud-upload-outline" loading={commit.isPending} disabled={!result.newRows} onPress={() => commit.mutate()} />
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      <Divider />
      <Text variant="label" accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function RawRows({ table, headerRow }: { table: string[][]; headerRow: number }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ gap: 4 }}>
        {table.slice(0, 15).map((r, i) => (
          <Text key={i} variant="caption" tone={i === headerRow ? "default" : "muted"} style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
            {i + 1}. {r.join(" | ")}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function ParseErrors({ errors }: { errors: { line: number; message: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 2 }}>
      <Button title={`${plural(errors.length, "row")} could not be read`} variant="ghost" small onPress={() => setOpen((v) => !v)} />
      {open
        ? errors.slice(0, 30).map((e) => (
            <Text key={e.line} variant="caption" tone="warning">
              Line {e.line}: {e.message}
            </Text>
          ))
        : null}
    </View>
  );
}
