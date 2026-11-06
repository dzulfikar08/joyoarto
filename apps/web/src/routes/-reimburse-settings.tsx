// Settings → Reimbursement: the companies that pay expenses back, and what their claim reports print about you.

import { Button } from "@baroka/ui/components/button";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { BriefcaseBusiness } from "lucide-react";
import { Input } from "@baroka/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Field } from "@/components/kit";
import { useReimburseProfiles } from "@/components/receipts";
import { client, errorMessage, orpc } from "@/lib/orpc";

type Profile = NonNullable<ReturnType<typeof useReimburseProfiles>["data"]>["profiles"][number];
type Form = { companyName: string; claimantName: string; employeeId: string; department: string; approverName: string; approverEmail: string };

const blank = (name: string): Form => ({ companyName: "", claimantName: name, employeeId: "", department: "", approverName: "", approverEmail: "" });
const fromProfile = (p: Profile): Form => ({
  companyName: p.companyName,
  claimantName: p.claimantName,
  employeeId: p.employeeId ?? "",
  department: p.department ?? "",
  approverName: p.approverName ?? "",
  approverEmail: p.approverEmail ?? "",
});

export function ReimburseSettings() {
  const qc = useQueryClient();
  const me = useQuery(orpc.me.queryOptions());
  const profiles = useReimburseProfiles();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: orpc.reimburse.key() });
    void qc.invalidateQueries({ queryKey: orpc.accounts.key() });
  };
  const remove = useMutation({
    mutationFn: (id: string) => client.reimburse.profiles.delete({ id }),
    onSuccess: (r) => {
      toast.success(r.archived ? "Archived (its reports stay downloadable)" : "Deleted");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = (profiles.data?.profiles ?? []).filter((p) => !p.archived);

  return (
    <Disclosure id="reimburse" icon={<BriefcaseBusiness />} title="Reimbursement · Diganti kantor" description="Companies that pay work expenses back" bodyClassName="space-y-3 text-foreground">
      <div>
        <p className="text-muted-foreground">
          Who pays work expenses back, and what your claim reports print. Make reports on the{" "}
          <Link to="/reimburse" className="font-semibold text-primary underline">
            Reimburse
          </Link>{" "}
          page; JoyoArto never sends anything to the company.
        </p>
      </div>
      {profiles.isError && <p className="text-destructive">{errorMessage(profiles.error)}</p>}
      <ul className="divide-y divide-border">
        {list.map((p) => (
          <li key={p.id} className="py-2">
            {editing === p.id ? (
              <ProfileForm initial={fromProfile(p)} id={p.id} onDone={() => (setEditing(null), refresh())} onCancel={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p.companyName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[p.claimantName, p.employeeId, p.department, p.approverName && `approver ${p.approverName}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">owes {p.owed.display}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => confirm(`Remove ${p.companyName}?`) && remove.mutate(p.id)}>
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        <ProfileForm initial={blank(me.data?.user.name ?? "")} onDone={() => (setEditing(null), refresh())} onCancel={() => setEditing(null)} />
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          Add a company
        </Button>
      )}
    </Disclosure>
  );
}

function ProfileForm({ initial, id, onDone, onCancel }: { initial: Form; id?: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        companyName: f.companyName.trim(),
        claimantName: f.claimantName.trim() || undefined,
        employeeId: f.employeeId.trim() || null,
        department: f.department.trim() || null,
        approverName: f.approverName.trim() || null,
        approverEmail: f.approverEmail.trim() || null,
      };
      return id ? client.reimburse.profiles.update({ id, ...body }) : client.reimburse.profiles.create({ ...body, currency: "IDR" });
    },
    onSuccess: () => {
      toast.success("Saved");
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f.companyName.trim()) save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl bg-muted/60 p-3 sm:grid-cols-2">
      <Field label="Company · Perusahaan" htmlFor="rb-company">
        <Input id="rb-company" required maxLength={80} value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="PT Maju Jaya" />
      </Field>
      <Field label="Claimant · Nama pemohon" htmlFor="rb-name">
        <Input id="rb-name" maxLength={80} value={f.claimantName} onChange={(e) => set({ claimantName: e.target.value })} />
      </Field>
      <Field label="Employee ID · NIK" htmlFor="rb-id" hint="Optional">
        <Input id="rb-id" maxLength={40} value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })} />
      </Field>
      <Field label="Department · Departemen" htmlFor="rb-dept" hint="Optional">
        <Input id="rb-dept" maxLength={80} value={f.department} onChange={(e) => set({ department: e.target.value })} />
      </Field>
      <Field label="Approver · Penyetuju" htmlFor="rb-approver" hint="Optional">
        <Input id="rb-approver" maxLength={80} value={f.approverName} onChange={(e) => set({ approverName: e.target.value })} />
      </Field>
      <Field label="Approver email" htmlFor="rb-email" hint="Optional; printed on the report">
        <Input id="rb-email" type="email" maxLength={120} value={f.approverEmail} onChange={(e) => set({ approverEmail: e.target.value })} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending || !f.companyName.trim()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
