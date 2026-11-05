import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "@baroka/ui/components/badge";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Select } from "@baroka/ui/components/select";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Camera, ReceiptText, Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { parseAmountText } from "@baroka/api/lib/amount-text";
import type { AppRouterClient } from "@baroka/api/routers/index";

import { PageHeader } from "@/components/kit";
import { QuickAdd } from "@/components/quick-add";
import { REIMBURSE_LABEL, TransactionExtras } from "@/components/receipts";
import { requireSession } from "@/lib/auth";
import { accountOptions, categoryOptions } from "@/lib/options";
import { client, errorMessage, orpc } from "@/lib/orpc";

type Tx = Awaited<ReturnType<AppRouterClient["transactions"]["search"]>>["transactions"][number];
type Status = "" | "pending" | "posted";
const STATUS_ITEMS = [
  { value: "", label: "Any status" },
  { value: "pending", label: "Pending only" },
  { value: "posted", label: "Posted only" },
];
const REIMBURSE_FILTERS = ["any", "open", "draft", "submitted", "paid", "rejected", "none"] as const;
type ReimburseFilter = "" | (typeof REIMBURSE_FILTERS)[number];
const REIMBURSE_ITEMS = [
  { value: "", label: "Reimburse: all" },
  { value: "any", label: "Reimbursable (diganti kantor)" },
  { value: "open", label: "Reimburse: open" },
  { value: "draft", label: "Reimburse: not claimed yet" },
  { value: "submitted", label: "Reimburse: submitted" },
  { value: "paid", label: "Reimburse: paid back" },
  { value: "rejected", label: "Reimburse: rejected" },
  { value: "none", label: "Not reimbursable" },
];
type Filters = { q: string; accountId: string; category: string; uncategorized: boolean; from: string; to: string; status: Status; reimburse: ReimburseFilter };
export type TransactionsSearch = Partial<Filters>;

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Filters live in the URL, so other pages (the dashboard) can link straight to a filtered list. */
function validateSearch(raw: Record<string, unknown>): TransactionsSearch {
  const from = str(raw.from);
  const to = str(raw.to);
  const out: TransactionsSearch = {};
  if (str(raw.q)) out.q = str(raw.q).slice(0, 40);
  if (str(raw.accountId)) out.accountId = str(raw.accountId);
  if (str(raw.category)) out.category = str(raw.category);
  if (raw.uncategorized === true || raw.uncategorized === "true" || raw.uncategorized === 1 || raw.uncategorized === "1") out.uncategorized = true;
  if (isDay(from)) out.from = from;
  if (isDay(to)) out.to = to;
  if (raw.status === "pending" || raw.status === "posted") out.status = raw.status;
  if ((REIMBURSE_FILTERS as readonly string[]).includes(str(raw.reimburse))) out.reimburse = str(raw.reimburse) as ReimburseFilter;
  return out;
}

export const Route = createFileRoute("/transactions")({ beforeLoad: requireSession, validateSearch, component: Transactions });

function Transactions() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const f: Filters = {
    q: search.q ?? "",
    accountId: search.accountId ?? "",
    category: search.category ?? "",
    uncategorized: search.uncategorized ?? false,
    from: search.from ?? "",
    to: search.to ?? "",
    status: search.status ?? "",
    reimburse: search.reimburse ?? "",
  };
  const [remember, setRemember] = useState(true);
  // The search box types into local state; the URL follows after a pause so typing never fights the router.
  const [qText, setQText] = useState(f.q);
  const q = f.q;
  useEffect(() => setQText(f.q), [f.q]);
  useEffect(() => {
    if (qText === f.q) return;
    const id = setTimeout(() => set({ q: qText }), 300);
    return () => clearTimeout(id);
  }, [qText]);

  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: {} }));
  const categories = useQuery(orpc.categories.list.queryOptions());

  const input = {
    limit: 50,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.uncategorized ? { uncategorized: true } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.reimburse ? { reimburse: f.reimburse } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ["transactions", input],
    queryFn: ({ pageParam }) => client.transactions.search({ ...input, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const categorize = useMutation({
    mutationFn: (v: { id: string; category: string; merchant: string | null }) =>
      v.category
        ? client.transactions.categorize({
            ids: [v.id],
            category: v.category,
            ...(remember && v.merchant
              ? { createRule: { field: "merchant", match: "equals", pattern: v.merchant, applyToExisting: true } }
              : {}),
          })
        : client.transactions.update({ id: v.id, category: null }).then(() => null),
    onSuccess: (res) => {
      if (res?.rule)
        toast.success("Rule saved", {
          description: `${res.rule.when} → ${res.category}${res.ruleAppliedToExisting ? ` (also applied to ${res.ruleAppliedToExisting} more)` : ""}`,
        });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: orpc.reports.key() });
    },
    onError: (e) => toast.error("Couldn't change the category", { description: errorMessage(e) }),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: orpc.reports.key() });
    void qc.invalidateQueries({ queryKey: orpc.accounts.key() });
  };
  const remove = useMutation({
    mutationFn: (id: string) => client.transactions.delete({ id }),
    onSuccess: () => {
      toast.success("Pending transaction deleted");
      refresh();
    },
    onError: (e) => toast.error("Couldn't delete it", { description: errorMessage(e) }),
  });
  const [editing, setEditing] = useState<string | null>(null);

  const rows = list.data?.pages.flatMap((p) => p.transactions) ?? [];
  const catItems = useMemo(() => categoryOptions(categories.data?.categories ?? []), [categories.data]);
  const accountItems = useMemo(() => accountOptions(accounts.data?.accounts ?? []), [accounts.data]);
  const set = (patch: Partial<Filters>) =>
    void navigate({
      replace: true,
      search: (prev) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        // Drop empty filters so the URL stays readable.
        for (const k of Object.keys(next)) if (next[k] === "" || next[k] === false) delete next[k];
        return next as TransactionsSearch;
      },
    });
  const filtered = Object.keys(search).length > 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions" />
      <QuickAdd collapsible />
      <Card className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-2 min-w-0 sm:min-w-48 sm:flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 pr-3 pl-9 sm:text-sm"
          type="search"
          placeholder="Search description or merchant"
          aria-label="Search"
          value={qText}
          maxLength={40}
          onChange={(e) => setQText(e.target.value)}
        />
        </div>
        <Combobox size="sm" className="sm:w-52" value={f.accountId} onValueChange={(v) => set({ accountId: v })} aria-label="Account" none="All accounts" items={accountItems} searchPlaceholder="Search accounts" />
        <Combobox
          size="sm"
          className="sm:w-56"
          value={f.category}
          onValueChange={(v) => set({ category: v, uncategorized: false })}
          aria-label="Category"
          none="All categories"
          items={catItems}
          searchPlaceholder="Search categories"
        />
        <Select size="sm" className="sm:w-36" value={f.status} onValueChange={(v) => set({ status: v as Status })} aria-label="Status" items={STATUS_ITEMS} />
        <Select size="sm" className="sm:w-60" value={f.reimburse} onValueChange={(v) => set({ reimburse: v as ReimburseFilter })} aria-label="Reimburse" items={REIMBURSE_ITEMS} />
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={f.uncategorized} onChange={(e) => set({ uncategorized: e.target.checked, category: "" })} />
          Uncategorized only
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          From
          <Input type="date" className="h-10 px-3 sm:text-sm" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          To
          <Input type="date" className="h-10 px-3 sm:text-sm" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </label>
        {filtered && (
          <Button variant="link" size="sm" className="col-span-2 h-10 justify-self-start" onClick={() => void navigate({ search: {}, replace: true })}>
            Clear filters
          </Button>
        )}
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember a category I pick for that merchant (adds a rule and fills in its past uncategorized rows)
      </label>
      </Card>

      {list.isPending && (
        <div className="space-y-2" aria-busy aria-label="Loading">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      )}
      {list.isError && <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">{errorMessage(list.error)}</p>}
      {!list.isPending && !list.isError && !rows.length && (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">{filtered ? <SearchX /> : <ReceiptText />}</EmptyMedia>
              <EmptyTitle>{filtered ? "Nothing matches" : "No transactions yet"}</EmptyTitle>
              <EmptyDescription>
                {filtered ? "No transactions match these filters." : "Import a statement, ask Claude to import one, or quick add what you just spent."}
              </EmptyDescription>
            </EmptyHeader>
            {!filtered && (
              <EmptyContent>
                <Link to="/import" className={buttonVariants({ size: "sm" })}>
                  Import a statement
                </Link>
              </EmptyContent>
            )}
          </Empty>
        </Card>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-card empty:hidden">
        {rows.map((t) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:flex-wrap sm:px-5 sm:py-2.5">
            <span className="hidden w-20 shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{t.date}</span>
            <div className="min-w-0 sm:flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">{t.merchant ?? t.description}</span>
                {t.status === "pending" && (
                  <Badge
                    tone="warning"
                    className="px-2 py-px text-[10px] tracking-wide uppercase"
                    title={`Quick add${t.capturedVia ? ` (${t.capturedVia})` : ""}; the next statement import of this account confirms it`}
                  >
                    pending
                  </Badge>
                )}
                {t.reimburse && (
                  <Badge tone={t.reimburse.status === "rejected" ? "destructive" : t.reimburse.status === "paid" || t.reimburse.status === "payment" ? "positive" : "primary"} className="px-2 py-px text-[10px] tracking-wide uppercase">
                    {REIMBURSE_LABEL[t.reimburse.status]}
                  </Badge>
                )}
                {t.attachments.length > 0 && <Camera className="size-3.5 shrink-0 text-muted-foreground" aria-label={`${t.attachments.length} receipt photo(s)`} />}
              </div>
              <div className="truncate text-xs text-muted-foreground" title={t.description}>
                <span className="tabular-nums sm:hidden">{t.date} · </span>
                {t.account} · {t.description}
              </div>
            </div>
            <span className={`self-start text-right text-sm font-semibold tabular-nums sm:order-2 sm:w-32 sm:self-auto ${t.amount < 0 ? "" : "text-positive"}`}>{t.display}</span>
            <div className="col-span-2 flex items-center gap-3 sm:contents">
              <Combobox
                lazy
                size="xs"
                className="flex-1 sm:order-1 sm:w-44 sm:flex-none"
                aria-label={`Category of ${t.merchant ?? t.description}`}
                value={t.category ?? ""}
                disabled={categorize.isPending}
                onValueChange={(v) => categorize.mutate({ id: t.id, category: v, merchant: t.merchant })}
                none="Uncategorized"
                items={catItems}
                searchPlaceholder="Search categories"
              />
              <span className="flex shrink-0 gap-3 sm:order-3 sm:gap-2">
                <button type="button" className="py-1 text-xs font-semibold text-primary hover:underline" aria-expanded={editing === t.id} onClick={() => setEditing(editing === t.id ? null : t.id)}>
                  {editing === t.id ? "Close" : t.status === "pending" ? "Edit" : "Details"}
                </button>
                {t.status === "pending" && (
                  <button
                    type="button"
                    className="py-1 text-xs font-semibold text-destructive hover:underline"
                    disabled={remove.isPending}
                    onClick={() => confirm(`Delete the pending ${t.display} · ${t.merchant ?? t.description}?`) && remove.mutate(t.id)}
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>
            {editing === t.id && t.status === "pending" && <EditPending t={t} onDone={() => (setEditing(null), refresh())} />}
            {editing === t.id && <TransactionExtras t={t} />}
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

/** Pending rows can still be corrected (amount, date, description); a statement row's own fields never change. */
function EditPending({ t, onDone }: { t: Tx; onDone: () => void }) {
  const [amountText, setAmountText] = useState(t.display.replace(/^-/, ""));
  const [out, setOut] = useState(t.amount < 0);
  const [date, setDate] = useState(t.date);
  const [description, setDescription] = useState(t.description);
  const [note, setNote] = useState(t.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const parsed = parseAmountText(amountText, t.currency);
      const sign = parsed.sign ?? (out ? -1 : 1);
      return client.transactions.update({ id: t.id, amount: sign * parsed.amount, date, description: description.trim(), note: note.trim() || null });
    },
    onSuccess: () => {
      toast.success("Pending transaction updated");
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form
      className="col-span-2 grid w-full grid-cols-2 items-center gap-2 pb-1 sm:order-4 sm:flex sm:flex-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="col-span-2 flex h-10 rounded-full bg-muted p-1 text-xs sm:col-span-1" role="group" aria-label="Direction">
        {([true, false] as const).map((o) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={out === o}
            className={`flex-1 rounded-full px-3 font-semibold transition-colors ${out === o ? "bg-segment text-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setOut(o)}
          >
            {o ? "Spent" : "Received"}
          </button>
        ))}
      </div>
      <Input className="col-span-2 h-10 px-3 sm:w-32 sm:text-sm" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-label="Amount" />
      <Input type="date" className="col-span-2 h-10 px-3 sm:w-auto sm:text-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <Input className="col-span-2 h-10 px-3 sm:w-auto sm:min-w-40 sm:flex-1 sm:text-sm" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
      <Input className="col-span-2 h-10 px-3 sm:w-auto sm:min-w-32 sm:flex-1 sm:text-sm" placeholder="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <Button type="submit" size="sm" className="col-span-2" disabled={save.isPending || !description.trim()}>
        Save
      </Button>
      {error && <span className="col-span-2 w-full text-xs text-destructive">{error}</span>}
    </form>
  );
}
