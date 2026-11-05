import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Badge } from "@baroka/ui/components/badge";
import { Button } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Input } from "@baroka/ui/components/input";
import { Combobox } from "@baroka/ui/components/combobox";
import { Select } from "@baroka/ui/components/select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Landmark } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageHeader } from "@/components/kit";
import { requireSession } from "@/lib/auth";
import { rupiahToMinor } from "@/lib/format";
import { client, errorMessage, orpc } from "@/lib/orpc";

export const Route = createFileRoute("/accounts")({ beforeLoad: requireSession, component: Accounts });

const INSTITUTIONS = [
  ["bca", "BCA"], ["mandiri", "Mandiri"], ["jago", "Jago"], ["jenius", "Jenius"], ["bni", "BNI"], ["bri", "BRI"],
  ["gopay", "GoPay"], ["ovo", "OVO"], ["dana", "DANA"], ["shopeepay", "ShopeePay"], ["cash", "Cash"], ["other", "Other"],
] as const;
const TYPES = [["bank", "Bank account"], ["credit_card", "Credit card"], ["ewallet", "E-wallet"], ["cash", "Cash"], ["investment", "Investment"], ["loan", "Loan"], ["other", "Other"]] as const;
const INSTITUTION_ITEMS = INSTITUTIONS.map(([value, label]) => ({ value, label: label as string }));
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

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <PageHeader title="Accounts" />
        {accounts.isPending && (
          <div className="grid gap-3 sm:grid-cols-2" aria-busy aria-label="Loading">
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-24 rounded-3xl" />
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
                <EmptyDescription>
                  Add each bank account, card and e-wallet below, then import its statement. Bank Jago pockets are created for you when you import a Jago statement.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <Card key={a.id} className={`space-y-1 ${a.archived ? "opacity-60" : ""}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 font-bold tracking-tight">
                  {a.name}
                  {a.last4 ? <span className="font-medium whitespace-nowrap text-muted-foreground"> ··{a.last4}</span> : null}
                  {a.archived && (
                    <Badge className="ml-1.5 px-2 py-px align-middle text-[10px] tracking-wide uppercase">archived</Badge>
                  )}
                </div>
                <div className={`shrink-0 font-extrabold tracking-tight tabular-nums ${a.balance.amount < 0 ? "text-destructive" : ""}`}>{a.balance.display}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {instLabel.get(a.institution) ?? a.institution} · {typeLabel.get(a.type) ?? a.type} · {a.transactions} transaction{a.transactions === 1 ? "" : "s"}
                {a.firstDate ? (
                  <>
                    {" · "}
                    <span className="whitespace-nowrap">
                      {a.firstDate} → {a.lastDate}
                    </span>
                  </>
                ) : (
                  ""
                )}
              </div>
              {a.type === "receivable" ? (
                <Link to="/reimburse" className="inline-block py-1 text-xs font-semibold text-primary hover:underline">
                  Open items and claims
                </Link>
              ) : (
                <button
                  type="button"
                  className="py-1 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate({ id: a.id, archived: !a.archived })}
                >
                  {a.archived ? "Unarchive" : "Archive"}
                </button>
              )}
            </Card>
          ))}
        </div>
      </section>

      <form
        className="grid grid-cols-2 items-end gap-3 rounded-3xl bg-card p-4 sm:flex sm:flex-wrap sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) create.mutate();
        }}
      >
        <h2 className="col-span-2 w-full text-base font-bold tracking-tight">Add an account</h2>
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

      <section className="space-y-2">
        <h2 className="px-1 text-base font-bold tracking-tight">Recent imports</h2>
        {imports.data && !imports.data.imports.length && <p className="text-sm text-muted-foreground">None yet.</p>}
        {imports.isError && <p className="text-sm text-destructive">{errorMessage(imports.error)}</p>}
        {!!imports.data?.imports.length && (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-card text-sm">
            {imports.data.imports.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
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
      </section>
    </div>
  );
}
