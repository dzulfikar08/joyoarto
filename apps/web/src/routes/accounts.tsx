import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { Select } from "@baroka/ui/components/select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { cn } from "@baroka/ui/lib/utils";
import { Archive, ArchiveRestore, History, Landmark, Plus, ReceiptText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageHeader } from "@/components/kit";
import { requireSession } from "@/lib/auth";
import { formatMoney, rupiahToMinor } from "@/lib/format";
import { client, errorMessage, orpc } from "@/lib/orpc";

export const Route = createFileRoute("/accounts")({ beforeLoad: requireSession, component: Accounts });

const INSTITUTIONS = [
  ["bca", "BCA"], ["mandiri", "Mandiri"], ["jago", "Jago"], ["jenius", "Jenius"], ["bni", "BNI"], ["bri", "BRI"],
  ["gopay", "GoPay"], ["ovo", "OVO"], ["dana", "DANA"], ["shopeepay", "ShopeePay"], ["cash", "Cash"], ["other", "Other"],
] as const;
const TYPES = [["bank", "Bank account"], ["credit_card", "Credit card"], ["ewallet", "E-wallet"], ["cash", "Cash"], ["investment", "Investment"], ["loan", "Loan"], ["other", "Other"]] as const;
const INSTITUTION_ITEMS = INSTITUTIONS.map(([value, label]) => ({ value, label: label as string }));
/** "Jago · Main Pocket" shows as "Main Pocket": the bank is already on the badge and in the line below. */
function shortName(name: string, institution: string) {
  const prefix = `${institution} · `;
  return name.toLowerCase().startsWith(prefix.toLowerCase()) && name.length > prefix.length ? name.slice(prefix.length) : name;
}

/** Display order of the account groups and their plural labels. */
const TYPE_ORDER = ["bank", "ewallet", "credit_card", "cash", "investment", "loan", "receivable"] as const;
const GROUP_LABEL: Record<string, string> = { bank: "Bank accounts", ewallet: "E-wallets", credit_card: "Credit cards", cash: "Cash", investment: "Investments", loan: "Loans", receivable: "Owed by a company", other: "Other" };
const TYPE_ITEMS = TYPES.map(([value, label]) => ({ value, label: label as string }));

function Accounts() {
  const qc = useQueryClient();
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { includeArchived: true } }));
  const imports = useQuery(orpc.imports.list.queryOptions());
  const [form, setForm] = useState({ name: "", institution: "bca" as (typeof INSTITUTIONS)[number][0], type: "bank" as (typeof TYPES)[number][0], last4: "", opening: "" });

  const create = useMutation({
    mutationFn: () =>
      client.accounts.create({
        name: form.name.trim(),
        institution: form.institution,
        type: form.type,
        ...(form.last4 ? { last4: form.last4 } : {}),
        openingBalance: rupiahToMinor(form.opening),
      }),
    onSuccess: () => {
      toast.success(`Added ${form.name.trim()}`);
      setForm((f) => ({ ...f, name: "", last4: "", opening: "" }));
      void qc.invalidateQueries();
    },
  });
  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => client.accounts.update(v),
    onSuccess: (_res, v) => {
      toast.success(v.archived ? "Account archived" : "Account unarchived");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error("Couldn't update the account", { description: errorMessage(e) }),
  });
  const undo = useMutation({
    mutationFn: (id: string) => client.imports.undo({ id }),
    onSuccess: () => {
      toast.success("Import undone");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error("Couldn't undo the import", { description: errorMessage(e) }),
  });
  const names = new Map(accounts.data?.accounts.map((a) => [a.id, a.name]));

  const typeLabel = new Map<string, string>([...TYPES, ["receivable", "Owed by a company (reimburse)"]]);
  const instLabel = new Map<string, string>(INSTITUTIONS);
  const list = accounts.data?.accounts ?? [];

  const active = list.filter((a) => !a.archived);
  const archived = list.filter((a) => a.archived);
  const idr = active.filter((a) => a.currency === "IDR");
  const total = idr.reduce((s, a) => s + a.balance.amount, 0);
  const groups: { type: string; items: typeof active }[] = TYPE_ORDER.map((type) => ({ type, items: active.filter((a) => a.type === type) })).filter((g) => g.items.length);
  const other = active.filter((a) => !TYPE_ORDER.includes(a.type as (typeof TYPE_ORDER)[number]));
  if (other.length) groups.push({ type: "other", items: other });

  const row = (a: (typeof list)[number]) => (
    <li key={a.id} className="flex items-center gap-3 py-3 pr-2 pl-4 sm:pl-5">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-xs font-extrabold text-primary-ink">
        {(instLabel.get(a.institution) ?? a.institution).slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <Link to="/transactions" search={{ accountId: a.id }} title={a.name} className="block truncate font-semibold hover:underline">
          {shortName(a.name, instLabel.get(a.institution) ?? a.institution)}
          {a.last4 ? <span className="font-medium text-muted-foreground max-sm:hidden"> ··{a.last4}</span> : null}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {instLabel.get(a.institution) ?? a.institution}{" · "}
          {a.transactions} transaction{a.transactions === 1 ? "" : "s"}
          {a.lastDate ? ` · last ${a.lastDate}` : ""}
        </p>
      </div>
      <p className={cn("shrink-0 font-bold tabular-nums", a.balance.amount < 0 && "text-destructive")}>{a.balance.display}</p>
      {a.type === "receivable" ? (
        <Link to="/reimburse" aria-label={`Claims for ${a.name}`} title="Claims" className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "shrink-0 text-muted-foreground" })}>
          <ReceiptText />
        </Link>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={`${a.archived ? "Unarchive" : "Archive"} ${a.name}`}
          title={a.archived ? "Unarchive" : "Archive"}
          disabled={archive.isPending}
          onClick={() => archive.mutate({ id: a.id, archived: !a.archived })}
        >
          {a.archived ? <ArchiveRestore /> : <Archive />}
        </Button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Accounts" subtitle="Banks, cards and e-wallets in one place" />
      {accounts.isPending && (
        <div className="space-y-3" aria-busy aria-label="Loading">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-48 rounded-3xl" />
        </div>
      )}
      {accounts.isError && <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">{errorMessage(accounts.error)}</p>}
      {accounts.isSuccess && !list.length && (
        <Card>
          <Empty className="p-2 md:p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Landmark />
              </EmptyMedia>
              <EmptyTitle>No accounts yet</EmptyTitle>
              <EmptyDescription>Add a bank account, card or e-wallet below, or import a Bank Jago statement: its pockets become accounts.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}

      {!!active.length && (
        <section className="rounded-3xl bg-primary p-5 text-primary-foreground shadow-float dark:bg-primary-soft dark:text-foreground sm:p-6">
          <p className="text-sm font-medium opacity-75">Total balance</p>
          <p className="mt-1 text-[2rem] leading-tight font-extrabold tracking-tight tabular-nums">{formatMoney(total)}</p>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {groups.map((g) => (
              <li key={g.type}>
                <span className="opacity-75">{GROUP_LABEL[g.type] ?? typeLabel.get(g.type) ?? g.type}</span>{" "}
                <span className="font-semibold tabular-nums">{formatMoney(g.items.filter((a) => a.currency === "IDR").reduce((s, a) => s + a.balance.amount, 0))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.type} className="overflow-hidden rounded-3xl bg-card">
          <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-1 sm:px-5">
            <h2 className="text-sm font-bold">{GROUP_LABEL[g.type] ?? typeLabel.get(g.type) ?? g.type}</h2>
            <span className="text-xs text-muted-foreground">
              {g.items.length} account{g.items.length === 1 ? "" : "s"}
            </span>
          </header>
          <ul className="divide-y divide-border">{g.items.map(row)}</ul>
        </section>
      ))}

      {!!archived.length && (
        <Disclosure title={`Archived (${archived.length})`} className="overflow-hidden">
          <ul className="-mx-4 divide-y divide-border opacity-70">{archived.map(row)}</ul>
        </Disclosure>
      )}

      <Disclosure title="Add an account" icon={<Plus />} defaultOpen={accounts.isSuccess && !list.length}>
        <form
          className="grid grid-cols-2 items-end gap-3 pt-1 sm:flex sm:flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim()) create.mutate();
          }}
        >
          <Field label="Name" htmlFor="acct-name" className="col-span-2 sm:flex-1 sm:basis-48">
            <Input id="acct-name" className="h-10 px-3 sm:text-sm" placeholder="BCA Tahapan" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Institution" htmlFor="acct-institution" className="sm:w-36">
            <Combobox
              id="acct-institution"
              size="sm"
              className="w-full"
              value={form.institution}
              onValueChange={(v) => setForm({ ...form, institution: v as typeof form.institution })}
              items={INSTITUTION_ITEMS}
              searchPlaceholder="Search banks and wallets"
            />
          </Field>
          <Field label="Type" htmlFor="acct-type" className="sm:w-40">
            <Select id="acct-type" size="sm" className="w-full" value={form.type} onValueChange={(v) => setForm({ ...form, type: v as typeof form.type })} items={TYPE_ITEMS} />
          </Field>
          <Field label="Last digits" htmlFor="acct-last4">
            <Input id="acct-last4" className="h-10 px-3 sm:w-24 sm:text-sm" inputMode="numeric" maxLength={8} placeholder="1234" value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value })} />
          </Field>
          <Field label="Opening balance (Rp)" htmlFor="acct-opening">
            <Input id="acct-opening" className="h-10 px-3 sm:w-36 sm:text-sm" inputMode="numeric" placeholder="0" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} />
          </Field>
          <Button type="submit" size="sm" className="col-span-2" disabled={create.isPending || !form.name.trim()}>
            {create.isPending ? "Adding…" : "Add account"}
          </Button>
          {create.isError && <p className="col-span-2 w-full text-sm text-destructive">{errorMessage(create.error)}</p>}
        </form>
      </Disclosure>

      <Disclosure title={`Recent imports${imports.data ? ` (${imports.data.imports.length})` : ""}`} icon={<History />}>
        {imports.data && !imports.data.imports.length && <p>None yet.</p>}
        {imports.isError && <p className="text-destructive">{errorMessage(imports.error)}</p>}
        {!!imports.data?.imports.length && (
          <ul className="-mx-4 divide-y divide-border text-foreground">
            {imports.data.imports.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {names.get(i.accountId) ?? "Unknown account"} · {i.fileName ?? i.source}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {i.periodFrom} → {i.periodTo}
                    </span>{" "}
                    · {i.insertedCount} added, {i.duplicateCount} duplicate{i.duplicateCount === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 py-1 text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
                  disabled={undo.isPending}
                  onClick={() => confirm(`Delete the ${i.insertedCount} transactions this import added?`) && undo.mutate(i.id)}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  );
}
