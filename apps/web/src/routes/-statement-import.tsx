import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@baroka/ui/components/badge";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { Button } from "@baroka/ui/components/button";
import { cn } from "@baroka/ui/lib/utils";
import { CircleCheck, FileUp, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { toast } from "sonner";

import { FormatRequestSheet } from "@/components/format-request";
import { openUpgrade } from "@/lib/billing";
import { client, errorMessage, orpc } from "@/lib/orpc";
import { commitOrder, crossMatches, mapLimit, periodLabel, textKey } from "@/lib/statement-batch";
import type { StatementInfo } from "@/lib/statement-batch";
import { takeSharedFiles } from "@/lib/shared-files";

type Result = Awaited<ReturnType<typeof client.imports.statement>>;

type Item = {
  id: string;
  name: string;
  busy: "reading" | "checking" | "saving" | null;
  text?: string;
  key?: string;
  info?: StatementInfo;
  readError?: string;
  /** Name of an earlier file in the batch with exactly the same text. */
  duplicateOf?: string;
  preview?: Result;
  previewError?: string;
  result?: Result;
  saveError?: string;
};

type Status = "reading" | "checking" | "saving" | "unreadable" | "duplicate" | "unknown" | "failed" | "problems" | "ready" | "saved" | "save-failed";

function statusOf(x: Item): Status {
  if (x.busy) return x.busy;
  if (x.readError) return "unreadable";
  if (x.duplicateOf) return "duplicate";
  if (x.info?.kind === "unknown") return "unknown";
  if (x.result?.committed) return "saved";
  if (x.previewError) return "failed";
  if (x.preview?.problems.length) return "problems";
  if (x.saveError) return "save-failed";
  return x.preview ? "ready" : "checking";
}

const canSave = (s: Status) => s === "ready" || s === "save-failed";

const STATUS: Record<Status, { label: string; tone: "muted" | "primary" | "positive" | "warning" | "destructive" }> = {
  reading: { label: "Reading", tone: "muted" },
  checking: { label: "Checking", tone: "muted" },
  saving: { label: "Saving", tone: "primary" },
  unreadable: { label: "Can't read", tone: "destructive" },
  duplicate: { label: "Same file twice", tone: "muted" },
  unknown: { label: "Not recognised", tone: "warning" },
  failed: { label: "Check failed", tone: "destructive" },
  problems: { label: "Doesn't add up", tone: "warning" },
  ready: { label: "Ready", tone: "positive" },
  saved: { label: "Saved", tone: "positive" },
  "save-failed": { label: "Not saved", tone: "destructive" },
};

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
let seq = 0;

/**
 * Bank Jago and GoPay statement PDFs, one or a whole batch: text is extracted here (pdf.js), each file is previewed
 * (JoyoArto parses and verifies it), then one button saves them all in commitOrder. `shared` is set when the page was
 * opened by the PWA share target (public/sw.js).
 */
export function StatementImport({ shared }: { shared?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharedNote, setSharedNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const billing = useQuery(orpc.billing.status.queryOptions());
  const importUsage = billing.data?.usage.statementImports;
  /** Statement imports left this month on Free; null = unlimited. */
  const importsLeft = importUsage && importUsage.limit !== null ? Math.max(0, importUsage.limit - importUsage.used) : null;
  const input = useRef<HTMLInputElement>(null);
  // Read by add() and the drop handler: files that arrive while a batch saves would replace the saved items.
  const savingRef = useRef(false);
  // The latest items for async work that outlives a render.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = async (list: File[]) => {
    if (!list.length) return;
    if (savingRef.current) {
      toast.info("Still saving the statements. Add more files when it's done.");
      return;
    }
    const fresh: Item[] = list.map((f) => ({
      id: `f${++seq}`,
      name: f.name || "statement.pdf",
      busy: isPdf(f) ? "reading" : null,
      ...(isPdf(f) ? {} : { readError: "Not a PDF. Jago and GoPay statements are PDFs; CSV exports go in the section below." }),
    }));
    // Files saved by an earlier batch are done; the new files start a new batch.
    setItems((xs) => [...xs.filter((x) => !x.result?.committed), ...fresh]);
    const [{ pdfText }, { describeStatement }] = await Promise.all([import("@/lib/pdf-text"), import("@/lib/statement-describe")]);
    const pdfs = fresh.map((item, i) => ({ item, file: list[i]! })).filter(({ file }) => isPdf(file));
    const seen = new Map(itemsRef.current.filter((x) => x.key && !x.result?.committed).map((x) => [x.key!, x.name]));

    // A few at a time: every PDF is held in memory while pdf.js reads it.
    const read = await mapLimit(pdfs, 3, async ({ item, file }) => {
      try {
        const text = await pdfText(file);
        const key = textKey(text);
        const twin = seen.get(key);
        if (!twin) seen.set(key, item.name);
        const info = describeStatement(text);
        patch(item.id, { busy: null, text, key, info, ...(twin ? { duplicateOf: twin } : {}) });
        return twin || info.kind === "unknown" ? null : { id: item.id, text, name: item.name };
      } catch {
        patch(item.id, { busy: null, readError: "Could not read this PDF. Is it a statement PDF (not a scan or a password-protected file)?" });
        return null;
      }
    });

    const toCheck = read.filter((x): x is NonNullable<typeof x> => !!x);
    for (const x of toCheck) patch(x.id, { busy: "checking" });
    await mapLimit(toCheck, 2, async (x) => {
      try {
        const preview = await client.imports.statement({ text: x.text, fileName: x.name, commit: false });
        patch(x.id, { busy: null, preview });
      } catch (e) {
        patch(x.id, { busy: null, previewError: errorMessage(e) });
      }
    });
  };

  // Files shared to the installed app wait in the service worker's cache, whatever URL the page was opened with.
  useEffect(() => {
    let live = true;
    void takeSharedFiles()
      .then(({ files, failed }) => {
        if (!live) return;
        if (failed) {
          const got = files.length ? `${files.length} shared file${files.length > 1 ? "s" : ""} arrived, but ` : "";
          setSharedNote({ tone: "error", text: `${got}${failed} couldn't be loaded. They're still waiting: reload this page, or choose the PDFs here.` });
          if (files.length) void add(files);
        } else if (files.length) {
          setSharedNote({ tone: "info", text: `${files.length} file${files.length > 1 ? "s" : ""} shared to JoyoArto.` });
          void add(files);
        } else if (shared === "failed") {
          setSharedNote({ tone: "error", text: "The shared files didn't reach JoyoArto. Open the app once, then share again, or choose the PDFs here." });
        } else if (shared === "none") {
          setSharedNote({ tone: "error", text: "Nothing to import arrived with the share. Share the statement PDF itself." });
        }
      })
      .catch(() => {
        if (live) setSharedNote({ tone: "error", text: "The shared files couldn't be loaded. They're still waiting: reload this page, or choose the PDFs here." });
      })
      // The note is shown; a reload should not show it again.
      .finally(() => live && shared && void navigate({ to: "/import", search: {}, replace: true }));
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    const order = commitOrder(itemsRef.current.filter((x) => canSave(statusOf(x)) && x.info) as (Item & { info: StatementInfo })[]);
    if (!order.length) return;
    // Free: a couple of statements a month, one batch at a time. The server counts too; this just asks first.
    if (importsLeft !== null && order.length > importsLeft) {
      openUpgrade(importsLeft === 0 ? "statementImports" : "bulkImport");
      return;
    }
    setSaving(true);
    savingRef.current = true;
    let saved = 0;
    let failed = 0;
    // One at a time, in order: GoPay first, so the Jago payments arrive already named (see commitOrder).
    for (const x of order) {
      patch(x.id, { busy: "saving", saveError: undefined });
      try {
        const result = await client.imports.statement({ text: x.text!, fileName: x.name, commit: true });
        if (result.committed) {
          patch(x.id, { busy: null, result });
          saved++;
        } else {
          // The server checks again and refuses a statement that doesn't add up.
          patch(x.id, { busy: null, saveError: result.problems[0] ? `it doesn't add up (${result.problems[0]})` : "the server didn't save it" });
          failed++;
        }
      } catch (e) {
        patch(x.id, { busy: null, saveError: errorMessage(e) });
        failed++;
      }
    }
    setSaving(false);
    savingRef.current = false;
    void qc.invalidateQueries();
    if (saved) toast.success(`Imported ${saved} statement${saved > 1 ? "s" : ""}`, failed ? { description: `${failed} not saved; see the list.` } : undefined);
    else toast.error("Nothing was saved. See the list.");
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void add([...e.dataTransfer.files]);
  };

  const statuses = items.map(statusOf);
  const busy = statuses.some((s) => s === "reading" || s === "checking" || s === "saving");
  const ready = statuses.filter(canSave).length;
  const skipped = statuses.filter((s) => ["unreadable", "duplicate", "unknown", "failed", "problems"].includes(s)).length;
  const cross = crossMatches(items.filter((x) => x.info && !x.duplicateOf).map((x) => ({ key: x.id, info: x.info! })));
  const savedItems = items.filter((x) => x.result?.committed);

  return (
    <div
      className="card space-y-4"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        if (savingRef.current) {
          e.dataTransfer.dropEffect = "none";
          return;
        }
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div>
        <h2 className="text-base font-bold tracking-tight">Statement PDFs (Bank Jago, GoPay)</h2>
        <p className="text-sm text-muted-foreground">Add every month at once. Each balance is checked, and nothing is added twice.</p>
        {importsLeft !== null && importUsage && (
          <p className="mt-1 text-xs text-muted-foreground">
            Free plan: {importsLeft} of {importUsage.limit} statement imports left this month.{" "}
            <Link to="/pricing" className="font-semibold text-primary underline">
              Pro is unlimited
            </Link>
            .
          </p>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border px-4 py-6 text-center transition-colors",
          dragging && "border-primary bg-primary-soft",
        )}
      >
        <FileUp aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          <span className="hidden sm:inline">Drop the PDFs here, or </span>
          <span className="sm:hidden">Pick several PDFs at once.</span>
        </p>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => input.current?.click()}>
          Choose PDFs
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          data-testid="statement-files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void add(files);
          }}
        />
      </div>

      {sharedNote && <p className={cn("text-sm", sharedNote.tone === "error" ? "text-destructive" : "text-muted-foreground")}>{sharedNote.text}</p>}

      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl bg-muted/60 text-sm" aria-label="Statements in this batch">
          {items.map((x, i) => (
            <FileRow key={x.id} item={x} status={statuses[i]!} cross={cross.get(x.id) ?? 0} onRemove={saving ? undefined : () => setItems((xs) => xs.filter((y) => y.id !== x.id))} />
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" disabled={busy || ready === 0} onClick={() => void save()}>
            {saving ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
            {ready > 0 ? `Import ${ready} statement${ready > 1 ? "s" : ""}` : "Import"}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setItems([])}>
            Clear
          </Button>
          <p className="text-xs text-muted-foreground">
            {busy && !saving ? "Checking the files… " : ""}
            {skipped > 0 && `${skipped} file${skipped > 1 ? "s" : ""} won't be imported. `}
            {ready > 1 && "GoPay is saved before Jago, so the Jago payments arrive already named and your rules see the real merchant."}
          </p>
        </div>
      )}

      {savedItems.length > 0 && !saving && <BatchResult saved={savedItems.map((x) => x.result!)} notSaved={items.filter((x) => !x.result?.committed && !x.duplicateOf).map((x) => x.name)} />}

      <ImportHelp />
    </div>
  );
}

function FileRow({ item: x, status, cross, onRemove }: { item: Item; status: Status; cross: number; onRemove?: () => void }) {
  const r = x.result ?? x.preview;
  const s = STATUS[status];
  const kind = x.info?.kind === "jago" ? "Bank Jago" : x.info?.kind === "gopay" ? "GoPay" : null;
  const facts: ReactNode[] = [];
  if (kind) facts.push(kind, periodLabel(x.info!.period));
  if (r?.kind === "jago") {
    const done = r.committed;
    facts.push(
      `${r.pockets.length} pocket${r.pockets.length > 1 ? "s" : ""}`,
      `${r.totals.rows} rows`,
      `${done ? r.totals.inserted : r.totals.newRows} new`,
      `${r.totals.duplicates} already in`,
    );
    const named = r.gopayMerchantsMerged + (done ? 0 : cross);
    const refs = x.info?.gopayRefs.length ?? 0;
    if (refs) facts.push(`GoPay merchants ${done ? "named" : "to name"}: ${Math.min(named, refs)} of ${refs}${!done && cross ? ` (${cross} from this batch)` : ""}`);
  } else if (r?.kind === "gopay") {
    const done = r.committed;
    facts.push(`${r.payments} payments`, `${done ? r.wallet.inserted : r.wallet.newRows} new from GoPay balance`, `${r.wallet.duplicates} already in`);
    // Saved before the Jago statements of the batch, it renames nothing itself: those arrive named.
    if (r.paidFromBank) facts.push(`${r.paidFromBank} paid from Jago${done ? (r.bankPaymentsNamed ? `, ${r.bankPaymentsNamed} Jago payments renamed` : "") : cross ? `, ${cross} in this batch` : ""}`);
  } else if (x.info && x.info.kind !== "unknown") {
    facts.push(`${x.info.rows} rows`);
  }

  return (
    <li className="space-y-1.5 p-3 sm:px-4">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-semibold break-all">{x.name}</span>
        <Badge tone={s.tone}>
          {(status === "reading" || status === "checking" || status === "saving") && <LoaderCircle aria-hidden className="animate-spin" />}
          {s.label}
        </Badge>
        {onRemove && status !== "saved" && (
          <button type="button" aria-label={`Remove ${x.name}`} className="-m-1 rounded-full p-1 text-muted-foreground hover:text-foreground" onClick={onRemove}>
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {facts.length > 0 && (
        <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          {facts.map((f, i) => [i > 0 && <span key={`s${i}`} aria-hidden>·</span>, <span key={i}>{f}</span>])}
        </p>
      )}
      <FileCheck item={x} status={status} result={r} />
      {r?.kind === "jago" && (
        <Disclosure plain title="Pockets">
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-max">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Pocket → account</th>
                  <th className="pr-3">New</th>
                  <th className="pr-3">Already in</th>
                  <th className="pr-3">Uncategorized</th>
                  <th className="text-right">Closing</th>
                </tr>
              </thead>
              <tbody>
                {r.pockets.map((p) => (
                  <tr key={p.pocket} className="border-t border-border">
                    <td className="py-1 pr-3">
                      {p.account}
                      {p.createdAccount && <span className="text-positive-ink"> (created)</span>}
                    </td>
                    <td className="pr-3">{r.committed ? p.inserted : p.newRows}</td>
                    <td className="pr-3">{p.duplicates}</td>
                    <td className="pr-3">{p.uncategorized}</td>
                    <td className="text-right tabular-nums">{p.closing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
    </li>
  );
}

function FileCheck({ item: x, status, result: r }: { item: Item; status: Status; result?: Result }) {
  const bad = (text: string) => (
    <p className="flex items-start gap-1.5 text-xs text-destructive">
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {text}
    </p>
  );
  if (status === "unreadable") return bad(x.readError!);
  if (status === "failed") return bad(x.previewError!);
  if (status === "save-failed") return bad(`Not saved: ${x.saveError}. Press Import to try again.`);
  if (status === "duplicate") return <p className="text-xs text-muted-foreground">Same statement as {x.duplicateOf}; added once.</p>;
  if (status === "unknown") return <Unsupported item={x} />;
  if (!r) return null;
  if (r.problems.length)
    return (
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning-ink">
        {r.problems.slice(0, 5).map((p) => (
          <li key={p}>{p}</li>
        ))}
        {r.problems.length > 5 && <li>…and {r.problems.length - 5} more. Nothing from this file will be saved.</li>}
      </ul>
    );
  return (
    <p className="flex items-start gap-1.5 text-xs font-medium text-positive-ink">
      <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-positive" />
      {r.kind === "jago" ? "Every running balance and pocket total matches." : "Totals match the statement."}
    </p>
  );
}

/** A statement JoyoArto can't read yet: say so, and offer to request support (masked; components/format-request.tsx). */
function Unsupported({ item: x }: { item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-warning-ink">
        We can't read this statement yet: JoyoArto reads Bank Jago monthly statements and GoPay e-statements. Use CSV import below, ask Claude to read the PDF, or ask
        us to support this bank.
      </p>
      {x.text && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Request support
          </Button>
          <FormatRequestSheet open={open} onOpenChange={setOpen} text={x.text} fileName={x.name} />
        </>
      )}
    </div>
  );
}

function BatchResult({ saved, notSaved }: { saved: Result[]; notSaved: string[] }) {
  let inserted = 0;
  let duplicates = 0;
  let named = 0;
  let reconciled = 0;
  let unmatched = 0;
  let created = 0;
  let waiting = 0;
  for (const r of saved) {
    if (r.kind === "jago") {
      inserted += r.totals.inserted;
      duplicates += r.totals.duplicates;
      // The service counts named rows before dedupe; a statement that was already in names nothing new.
      if (r.totals.inserted > 0) named += r.gopayMerchantsMerged;
      reconciled += r.totals.reconciled;
      unmatched += r.totals.unmatchedPending;
      created += r.pockets.filter((p) => p.createdAccount).length;
      waiting += r.gopayPaymentsWithoutHistory;
    } else {
      inserted += r.wallet.inserted;
      duplicates += r.wallet.duplicates;
      named += r.bankPaymentsNamed;
      reconciled += r.wallet.reconciled;
      unmatched += r.wallet.unmatchedPending;
    }
  }
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  return (
    <div role="status" className="space-y-1.5 rounded-2xl border border-border p-3 text-sm sm:p-4">
      <p className="flex items-start gap-1.5 font-semibold">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
        Saved {n(saved.length, "statement")}: {n(inserted, "new transaction")}, {duplicates} already in.
      </p>
      <ul className="space-y-0.5 pl-6 text-xs text-muted-foreground">
        {named > 0 && <li>{n(named, "GoPay payment")} named after the real merchant.</li>}
        {created > 0 && <li>{n(created, "account")} created for new Jago pockets.</li>}
        {reconciled > 0 && <li>{n(reconciled, "quick add")} confirmed by the statement.</li>}
        {unmatched > 0 && <li>{n(unmatched, "quick add")} in these months matched nothing; they stay pending.</li>}
        {waiting > 0 && <li>{n(waiting, "GoPay payment")} still wait for the GoPay e-statement of that month.</li>}
        {notSaved.length > 0 && <li>Not saved: {notSaved.join(", ")}.</li>}
      </ul>
      <Link to="/transactions" className="inline-block pl-6 text-sm font-semibold text-primary hover:underline">
        Review transactions
      </Link>
    </div>
  );
}

function ImportHelp() {
  return (
    <Disclosure plain title="Getting the PDFs from your phone">
      <p>
        Each Jago pocket becomes its own account, and the GoPay e-statements name the merchants behind “Gopay - Generic”.
      </p>
      <div className="space-y-2">
        <p>
          Download the monthly statement from the Jago app and the e-statement from GoPay for each month, and keep them together (on iPhone, Share →
          Save to Files, one folder for all of them). A password-protected or scanned PDF can't be read here.
        </p>
        <p>
          <span className="font-semibold text-foreground">iPhone and iPad:</span> tap Choose PDFs → Browse, open that folder, tap Select (top right),
          tick every PDF and tap Open. iOS can't share files straight into a web app.
        </p>
        <p>
          <span className="font-semibold text-foreground">Android:</span> install JoyoArto from Chrome's menu (Install app or Add to Home screen). Then
          select the PDFs in Files, Gmail or the bank app, tap Share and pick JoyoArto: they open here, ready to check.
        </p>
      </div>
    </Disclosure>
  );
}
