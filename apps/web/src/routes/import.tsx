import { DATE_FORMATS, MAPPING_PRESETS, parseCsv } from "@baroka/api/lib/csv";
import type { CsvMapping } from "@baroka/api/lib/csv";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@baroka/ui/components/button";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Select } from "@baroka/ui/components/select";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Field, PageHeader } from "@/components/kit";

import { requireSession } from "@/lib/auth";
import { formFromPreset, initialForm, presetHeaderRow, toMapping } from "@/lib/csv-form";
import type { Form } from "@/lib/csv-form";
import { accountOptions } from "@/lib/options";
import { client, errorMessage, orpc } from "@/lib/orpc";

import { StatementImport } from "./-statement-import";

export const Route = createFileRoute("/import")({
  beforeLoad: requireSession,
  // ?shared=1|none|failed: opened by the PWA share target (public/sw.js).
  validateSearch: (s: Record<string, unknown>): { shared?: string } => (typeof s.shared === "string" ? { shared: s.shared } : {}),
  component: ImportPage,
});

function ImportPage() {
  const { shared } = Route.useSearch();
  const qc = useQueryClient();
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: {} }));
  const mappings = useQuery(orpc.imports.mappings.queryOptions());
  const [accountId, setAccountId] = useState("");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saveAs, setSaveAs] = useState("");
  const [start, setStart] = useState("");

  const account = accounts.data?.accounts.find((a) => a.id === accountId);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const header = useMemo(() => (table && form ? (table[form.headerRow] ?? []) : []), [table, form]);

  const load = async (file: File) => {
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      alert("CSV here. Jago and GoPay PDFs go in the statement section below; for other PDFs or Excel files, ask Claude to import them.");
      return;
    }
    const parsed = parseCsv(await file.text());
    const preset = account ? MAPPING_PRESETS[account.institution] : undefined;
    setTable(parsed);
    setFileName(file.name);
    setForm(initialForm(parsed, preset?.mapping));
    preview.reset();
    commit.reset();
  };

  const run = (doCommit: boolean) =>
    client.imports.csv({
      accountId,
      table: table!,
      mapping: toMapping(form!),
      commit: doCommit,
      fileName,
      ...(doCommit && saveAs.trim() ? { saveMappingAs: saveAs.trim() } : {}),
    });
  const preview = useMutation({ mutationFn: () => run(false) });
  const commit = useMutation({
    mutationFn: () => run(true),
    onSuccess: (r) => {
      toast.success(`Saved ${r.inserted} transactions`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const result = commit.data ?? preview.data;
  const colOptions = header.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h || "(empty)"}` }));
  const col = { size: "default", className: "w-full", items: colOptions, searchPlaceholder: "Search columns" } as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import a statement"
        subtitle="Bank Jago and GoPay PDFs are read right here. For CSV exports, map the columns below. For any other bank's PDF, drop it into a Claude chat with JoyoArto connected and ask it to import it: it reads the layout, checks the running balance and shows a preview first."
      />

      <StatementImport shared={shared} />

      <div className="card space-y-4">
        <div>
          <h2 className="text-base font-bold tracking-tight">CSV or spreadsheet export</h2>
          <p className="text-sm text-muted-foreground">Pick the account it belongs to, then the file. You map the columns and see a preview before anything is saved.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account" htmlFor="csv-account">
            <Combobox
              id="csv-account"
              className="w-full"
              value={accountId}
              onValueChange={setAccountId}
              placeholder="Choose…"
              items={accountOptions(accounts.data?.accounts ?? [])}
              searchPlaceholder="Search accounts"
            />
          </Field>
          <Field label="File" htmlFor="csv-file" hint={accountId ? ".csv, .tsv or .txt" : "Choose the account first."}>
            <input id="csv-file" type="file" accept=".csv,.txt,.tsv" disabled={!accountId} onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} className="text-sm" />
          </Field>
        </div>
        {!accounts.data?.accounts.length && (
          <Link to="/accounts" className="inline-block text-sm font-semibold text-primary hover:underline">
            Add an account first
          </Link>
        )}
      </div>

      {table && form && (
        <div className="card space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight">Map the columns</h2>
              <p className="text-sm text-muted-foreground">
                {fileName}: tell JoyoArto which column holds what. Preview reads the file with these settings; nothing is saved yet.
              </p>
            </div>
            <Field label="Start from" htmlFor="map-start" className="w-full sm:w-64">
              <Combobox
                id="map-start"
                className="w-full"
                value={start}
                placeholder="Mapping…"
                onValueChange={(value) => {
                  setStart(value);
                  const [kind, key] = value.split(":");
                  const m =
                    kind === "preset" ? MAPPING_PRESETS[key!]?.mapping : (mappings.data?.saved.find((s) => s.id === key)?.mapping as CsvMapping | undefined);
                  if (!m) return;
                  const headerRow = presetHeaderRow(table, m, form.headerRow);
                  setForm({ ...form, headerRow, ...formFromPreset(table, headerRow, m) });
                }}
                items={[
                  ...(mappings.data?.saved.map((s) => ({ value: `saved:${s.id}`, label: `Saved: ${s.name}` })) ?? []),
                  ...Object.entries(MAPPING_PRESETS).map(([k, v]) => ({ value: `preset:${k}`, label: v.label })),
                ]}
                searchPlaceholder="Search mappings"
              />
            </Field>
          </div>

          <details className="rounded-2xl bg-muted/50 px-4 py-3 text-xs">
            <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">Raw file (first rows)</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs">
                <tbody>
                  {table.slice(0, 15).map((r, i) => (
                    <tr key={i} className={i === form.headerRow ? "font-semibold" : ""}>
                      <td className="pr-2 text-muted-foreground/70">{i + 1}</td>
                      {r.map((c, j) => (
                        <td key={j} className="whitespace-nowrap border border-border px-1.5 py-0.5">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <MapSection title="Rows and dates">
            <Field label="Header row" htmlFor="map-header" className="sm:col-span-2" hint="The row with the column names; rows above it are skipped.">
              <Combobox
                id="map-header"
                className="w-full"
                value={String(form.headerRow)}
                onValueChange={(v) => set({ headerRow: Number(v) })}
                items={table.slice(0, 30).map((r, i) => ({ value: String(i), label: `Row ${i + 1}: ${r.filter(Boolean).slice(0, 3).join(" | ").slice(0, 40)}` }))}
                searchPlaceholder="Search rows"
              />
            </Field>
            <Field label="Date column" htmlFor="map-date">
              <Combobox id="map-date" {...col} value={String(form.date)} onValueChange={(v) => set({ date: Number(v) })} />
            </Field>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
              <Field label="Date format" htmlFor="map-date-format">
                <Select id="map-date-format" className="w-full" value={form.dateFormat} onValueChange={(v) => set({ dateFormat: v as Form["dateFormat"] })} items={DATE_FORMATS.map((d) => ({ value: d, label: d }))} />
              </Field>
              {form.dateFormat === "DD/MM" && (
                <Field label="Year" htmlFor="map-year">
                  <Input id="map-year" className="w-20" inputMode="numeric" value={form.year} onChange={(e) => set({ year: e.target.value })} />
                </Field>
              )}
            </div>
          </MapSection>

          <fieldset className="space-y-2.5 border-t border-border pt-5">
            <legend className="float-left mb-1 w-full text-sm font-bold tracking-tight">Description</legend>
            <p className="clear-both text-xs text-muted-foreground">Pick every column that describes the transaction; they are joined in this order.</p>
            <div className="flex flex-wrap gap-2">
              {header.map((h, i) => (
                <label
                  key={i}
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-muted px-3.5 text-sm font-medium transition-colors has-data-checked:bg-primary-soft has-data-checked:text-primary-ink"
                >
                  <Checkbox
                    checked={form.description.includes(i)}
                    onCheckedChange={(checked) => set({ description: checked ? [...form.description, i].sort((a, b) => a - b) : form.description.filter((x) => x !== i) })}
                  />
                  {h || `Column ${i + 1}`}
                </label>
              ))}
            </div>
          </fieldset>

          <MapSection title="Amounts">
            <Field label="Amount columns" htmlFor="map-mode">
              <Select
                id="map-mode"
                className="w-full"
                value={form.mode}
                onValueChange={(v) => set({ mode: v as Form["mode"] })}
                items={[
                  { value: "single", label: "One amount column" },
                  { value: "split", label: "Separate debit and credit" },
                ]}
              />
            </Field>
            {form.mode === "single" ? (
              <>
                <Field label="Amount" htmlFor="map-amount">
                  <Combobox id="map-amount" {...col} value={String(form.amount)} onValueChange={(v) => set({ amount: Number(v) })} />
                </Field>
                <Field label="DB/CR column" htmlFor="map-marker" className="sm:col-span-2">
                  <Combobox id="map-marker" {...col} none="None (sign or DB/CR in amount)" value={form.marker === null ? "" : String(form.marker)} onValueChange={(v) => set({ marker: v === "" ? null : Number(v) })} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Debit (out)" htmlFor="map-debit">
                  <Combobox id="map-debit" {...col} value={String(form.debit)} onValueChange={(v) => set({ debit: Number(v) })} />
                </Field>
                <Field label="Credit (in)" htmlFor="map-credit">
                  <Combobox id="map-credit" {...col} value={String(form.credit)} onValueChange={(v) => set({ credit: Number(v) })} />
                </Field>
              </>
            )}
            <Field label="Balance" htmlFor="map-balance" hint="Lets the preview check every running balance.">
              <Combobox id="map-balance" {...col} none="None" value={form.balance === null ? "" : String(form.balance)} onValueChange={(v) => set({ balance: v === "" ? null : Number(v) })} />
            </Field>
            <Field label="Decimal mark" htmlFor="map-decimal">
              <Select
                id="map-decimal"
                className="w-full"
                value={form.decimal}
                onValueChange={(v) => set({ decimal: v as Form["decimal"] })}
                items={[
                  { value: "", label: "Guess" },
                  { value: "dot", label: "1,250.00" },
                  { value: "comma", label: "1.250,00" },
                ]}
              />
            </Field>
            {form.mode === "single" && (
              <label className="flex cursor-pointer items-start gap-2.5 text-sm sm:col-span-2 lg:col-span-4">
                <Checkbox className="mt-px" checked={form.invert} onCheckedChange={(checked) => set({ invert: checked })} />
                <span>
                  <span className="font-semibold">Flip signs</span>
                  <span className="text-muted-foreground"> for card statements that list spending as positive</span>
                </span>
              </label>
            )}
          </MapSection>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button className="w-full sm:w-auto" disabled={preview.isPending || !form.description.length} onClick={() => preview.mutate()}>
              {preview.isPending ? "Reading…" : "Preview"}
            </Button>
            {!form.description.length && <p className="text-sm text-muted-foreground">Pick at least one description column.</p>}
            {preview.isError && <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>}
          </div>
        </div>
      )}

      {result && (
        <div className="card space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <b>{result.newRows}</b> new
            </span>
            <span>{result.duplicates} already imported</span>
            <span>
              {result.period.from} → {result.period.to}
            </span>
            <span>In {result.moneyIn.display}</span>
            <span>Out {result.moneyOut.display}</span>
            <span>{result.uncategorized} uncategorized</span>
          </div>
          {result.balanceCheck.checked > 0 &&
            (result.balanceCheck.mismatches.length ? (
              <p className="rounded-2xl bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                Running balance does not add up on {result.balanceCheck.mismatches.length} row(s) (first: row {result.balanceCheck.mismatches[0]!.row + 1}). A sign or
                column is probably mapped wrong: check the amount settings.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-sm font-medium text-positive-ink"><CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" /> Amounts match the statement's running balance ({result.balanceCheck.checked} rows checked).</p>
            ))}
          {result.parseErrors?.length ? (
            <details className="text-sm text-warning-ink">
              <summary>{result.parseErrors.length} row(s) could not be read</summary>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.parseErrors.map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {result.committed ? (
            <p className="text-sm">
              Saved {result.inserted} transactions.{" "}
              <Link to="/transactions" className="font-semibold text-primary hover:underline">
                Review them
              </Link>
            </p>
          ) : (
            <>
              <div className="max-h-96 overflow-auto rounded-2xl bg-muted/40">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {result.preview.map((r) => (
                      <tr key={r.row}>
                        <td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums text-muted-foreground">{r.date}</td>
                        <td className="px-2 py-1">
                          <div className="font-medium">{r.merchant ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        </td>
                        <td className="px-2 py-1 text-xs text-muted-foreground">{r.category ?? ""}</td>
                        <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${r.amount < 0 ? "" : "text-positive"}`}>{r.display}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Save mapping as" htmlFor="map-save-as" hint="Optional: reuse it next time from “Start from”." className="sm:w-72">
                  <Input id="map-save-as" placeholder="e.g. BCA CSV" value={saveAs} onChange={(e) => setSaveAs(e.target.value)} />
                </Field>
                <Button className="sm:mb-[1.375rem]" disabled={commit.isPending || !result.newRows} onClick={() => commit.mutate()}>
                  {commit.isPending ? "Saving…" : `Import ${result.newRows} transactions`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One group of mapping fields: a heading and a grid that is one column on phones, two on tablets, four on desktop. */
function MapSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-border pt-5">
      <legend className="float-left mb-3 w-full text-sm font-bold tracking-tight">{title}</legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </fieldset>
  );
}
