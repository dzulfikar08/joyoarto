// Reimburse ("Diganti kantor"): open work expenses per company, a claim report (PDF with the receipt photos, or CSV)
// to email or print for approval, and the claims made so far (paid, rejected, withdrawn). Nothing is sent anywhere.

import type { AppRouterClient } from "@baroka/api/routers/index";
import { Badge } from "@baroka/ui/components/badge";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Card } from "@baroka/ui/components/card";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Combobox } from "@baroka/ui/components/combobox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@baroka/ui/components/empty";
import { Input } from "@baroka/ui/components/input";
import { Select } from "@baroka/ui/components/select";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Textarea } from "@baroka/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BriefcaseBusiness, FileDown, FileSpreadsheet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, PageHeader } from "@/components/kit";
import { REIMBURSE_LABEL, ReceiptThumb, useLedgerRefresh, useReimburseProfiles } from "@/components/receipts";
import { requireSession } from "@/lib/auth";
import { SERVER_URL, client, errorMessage, orpc } from "@/lib/orpc";

export const Route = createFileRoute("/reimburse")({ beforeLoad: requireSession, component: Reimburse });

type Claim = Awaited<ReturnType<AppRouterClient["reimburse"]["claims"]["list"]>>["claims"][number];

const CLAIM_STATUS: Record<Claim["status"], { label: string; tone: "primary" | "positive" | "destructive" }> = {
  submitted: { label: "Diajukan · Submitted", tone: "primary" },
  paid: { label: "Dibayar · Paid", tone: "positive" },
  rejected: { label: "Ditolak · Rejected", tone: "destructive" },
};

function download(path: string) {
  window.open(`${SERVER_URL}${path}`, "_blank", "noopener");
}

function Reimburse() {
  const profiles = useReimburseProfiles();
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);
  const [profileId, setProfileId] = useState("");
  useEffect(() => {
    if (!profileId && list[0]) setProfileId(list[0].id);
  }, [list, profileId]);
  const profile = list.find((p) => p.id === profileId) ?? list[0];

  if (profiles.isPending) return <Skeleton className="h-64 rounded-3xl" />;
  if (profiles.isError) return <p className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">{errorMessage(profiles.error)}</p>;

  return (
    <div className="space-y-5">
      <PageHeader title="Reimburse" subtitle="Work expenses your company pays back · Diganti kantor" />
      {!profile ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BriefcaseBusiness />
              </EmptyMedia>
              <EmptyTitle>Add the company that pays you back</EmptyTitle>
              <EmptyDescription>
                Then mark expenses “Diganti kantor” when you add them (snap the receipt), and make a claim report here to email or print for approval.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link to="/settings" hash="reimburse" className={buttonVariants({ size: "sm" })}>
                Settings → Reimbursement
              </Link>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <>
          {list.length > 1 && (
            <Select aria-label="Company" value={profile.id} onValueChange={setProfileId} items={list.map((p) => ({ value: p.id, label: p.companyName }))} />
          )}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Owed · Piutang" value={profile.owed.display} />
            <Stat label="Not claimed yet" value={`${profile.draft.count} · ${profile.draft.display}`} />
            <Stat label="Submitted" value={`${profile.submitted.count} · ${profile.submitted.display}`} />
          </div>
          <OpenItems profileId={profile.id} company={profile.companyName} />
          <Claims profileId={profile.id} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="min-w-0 space-y-1 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-bold tabular-nums">{value}</div>
    </Card>
  );
}

function OpenItems({ profileId, company }: { profileId: string; company: string }) {
  const refresh = useLedgerRefresh();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const items = useQuery(orpc.reimburse.items.queryOptions({ input: { profileId, status: "draft", ...(from ? { from } : {}), ...(to ? { to } : {}) } }));
  const rows = items.data?.items ?? [];
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Everything is selected until the member changes the selection.
  const selected = picked ?? new Set(rows.map((r) => r.id));
  useEffect(() => setPicked(null), [profileId, from, to]);
  const total = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s - r.amount, 0);
  const currency = rows[0]?.currency ?? "IDR";
  const create = useMutation({
    mutationFn: () => client.reimburse.claims.create({ profileId, transactionIds: [...selected], notes: notes.trim() || undefined, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    onSuccess: ({ claim }) => {
      toast.success(`Claim ${claim.number} ready`, { description: `${claim.itemCount} items · ${claim.total.display}` });
      setNotes("");
      setPicked(null);
      refresh();
      download(claim.pdfPath);
    },
    onError: (e) => toast.error("Couldn't make the report", { description: errorMessage(e) }),
  });
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Not claimed yet</h2>
          <p className="text-sm text-muted-foreground">Pick the items and period, then make the report for {company}.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
            From
            <Input type="date" className="h-10 px-3 sm:text-sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
            To
            <Input type="date" className="h-10 px-3 sm:text-sm" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>
      {items.isPending && <Skeleton className="h-32 rounded-2xl" />}
      {items.isError && <p className="text-sm text-destructive">{errorMessage(items.error)}</p>}
      {items.isSuccess && !rows.length && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          Nothing to claim{from || to ? " in this period" : ""}. Mark an expense “Diganti kantor” in the add sheet or on the{" "}
          <Link to="/transactions" className="font-semibold text-primary underline">
            Transactions
          </Link>{" "}
          page (Details).
        </p>
      )}
      <ul className="divide-y divide-border empty:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2.5">
            <Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, !!v)} aria-label={`Include ${r.merchant ?? r.description}`} />
            {r.attachments[0] ? (
              <ReceiptThumb id={r.attachments[0].id} alt={`Receipt ${r.merchant ?? r.description}`} className="size-11" />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-center text-[9px] leading-tight text-muted-foreground">tanpa bukti</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{r.merchant ?? r.description}</div>
              <div className="truncate text-xs text-muted-foreground">
                {r.date} · {r.account} · {r.categoryName ?? "Uncategorized"}
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums">{r.display.replace(/^-/, "")}</span>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <>
          <Field label="Keperluan / Purpose" htmlFor="claim-notes" hint="Printed on the report, e.g. “Kunjungan klien Bandung, 3–5 Nov”">
            <Textarea id="claim-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              {selected.size} item{selected.size === 1 ? "" : "s"} ·{" "}
              <b className="tabular-nums">{new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(total / 100)}</b>
            </span>
            <Button disabled={!selected.size || create.isPending} onClick={() => create.mutate()}>
              <FileDown aria-hidden /> {create.isPending ? "Making the report…" : "Buat laporan · Generate report"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Claims({ profileId }: { profileId: string }) {
  const claims = useQuery(orpc.reimburse.claims.list.queryOptions({ input: { profileId } }));
  const [open, setOpen] = useState<string | null>(null);
  const list = claims.data?.claims ?? [];
  if (claims.isSuccess && !list.length) return null;
  return (
    <Card className="space-y-3">
      <h2 className="text-base font-bold tracking-tight">Claim reports</h2>
      {claims.isError && <p className="text-sm text-destructive">{errorMessage(claims.error)}</p>}
      <ul className="divide-y divide-border">
        {list.map((c) => (
          <li key={c.id} className="space-y-3 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold whitespace-nowrap">{c.number}</span>
                  <Badge tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.periodFrom} – {c.periodTo} · {c.itemCount} items · <span className="tabular-nums">{c.total.display}</span>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => download(c.pdfPath)}>
                <FileDown aria-hidden /> PDF
              </Button>
              <Button size="sm" variant="ghost" onClick={() => download(c.csvPath)}>
                <FileSpreadsheet aria-hidden /> CSV
              </Button>
              <Button size="sm" variant="ghost" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? "Close" : "Status"}
              </Button>
            </div>
            {open === c.id && <ClaimStatus claim={c} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Paid (with the employer's incoming payment, and items they refused), rejected, reopened, or withdrawn. */
function ClaimStatus({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const refresh = useLedgerRefresh();
  const detail = useQuery(orpc.reimburse.claims.get.queryOptions({ input: { id: claim.id } }));
  const incoming = useQuery(orpc.transactions.search.queryOptions({ input: { direction: "in", from: claim.periodFrom, limit: 100, reimburse: "none" } }));
  const [paymentId, setPaymentId] = useState("");
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const paymentItems = useMemo(
    () => (incoming.data?.transactions ?? []).map((t) => ({ value: t.id, label: `${t.date} · ${t.merchant ?? t.description}`, hint: t.display })),
    [incoming.data],
  );
  const run = useMutation({
    mutationFn: (status: "paid" | "rejected" | "submitted") =>
      client.reimburse.claims.setStatus({ id: claim.id, status, ...(status === "paid" && paymentId ? { paymentTransactionId: paymentId } : {}), ...(status === "paid" ? { rejectIds: [...rejected] } : {}) }),
    onSuccess: (r) => {
      toast.success(`Claim ${r.claim.number}: ${CLAIM_STATUS[r.claim.status].label}`);
      refresh();
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: () => client.reimburse.claims.delete({ id: claim.id }),
    onSuccess: () => {
      toast.success("Withdrawn; the items are back in Not claimed yet");
      refresh();
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (claim.status !== "submitted") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 p-3 text-sm">
        <span className="flex-1 text-muted-foreground">
          {claim.status === "paid" && detail.data ? `Payments recorded: ${detail.data.payments.map((p) => p.display).join(", ") || "none"}. Difference ${detail.data.difference.display}.` : "Undo to change it."}
        </span>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate("submitted")}>
          Reopen
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-muted/60 p-3 text-sm">
      <Field label="The company's payment (money in)" hint="It then counts as a transfer, not income. Leave empty if it came with your salary or in cash.">
        <Combobox value={paymentId} onValueChange={setPaymentId} aria-label="Payment" none="Not recorded" items={paymentItems} searchPlaceholder="Search money in" />
      </Field>
      {detail.data && detail.data.items.length > 1 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-muted-foreground">Items the company did not pay (they count as your own spending again)</legend>
          {detail.data.items.map((i) => (
            <label key={i.id} className="flex items-center gap-2">
              <Checkbox
                checked={rejected.has(i.id)}
                onCheckedChange={(v) => {
                  const next = new Set(rejected);
                  if (v) next.add(i.id);
                  else next.delete(i.id);
                  setRejected(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate">
                {i.date} · {i.merchant ?? i.description}
              </span>
              <span className="tabular-nums">{i.display.replace(/^-/, "")}</span>
              {i.reimburse && i.reimburse.status !== "submitted" && <Badge>{REIMBURSE_LABEL[i.reimburse.status]}</Badge>}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate("paid")}>
          Mark paid
        </Button>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => confirm("Reject the whole claim? Its items count as your own spending again.") && run.mutate("rejected")}>
          Rejected
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={withdraw.isPending} onClick={() => confirm(`Withdraw ${claim.number}? The report is deleted and its items go back to Not claimed yet.`) && withdraw.mutate()}>
          Withdraw
        </Button>
      </div>
    </div>
  );
}
