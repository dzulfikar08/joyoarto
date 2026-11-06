import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@baroka/ui/components/badge";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { Mail } from "lucide-react";
import { Button } from "@baroka/ui/components/button";

import { ProNotice } from "@/components/upgrade";
import { client, errorMessage, orpc } from "@/lib/orpc";

const STATUS: Record<string, { label: string; tone: "positive" | "warning" | "destructive" | "muted" | "primary" }> = {
  imported: { label: "Imported", tone: "positive" },
  partial: { label: "Partly imported", tone: "warning" },
  failed: { label: "Not imported", tone: "destructive" },
  no_pdf: { label: "No PDF", tone: "warning" },
  rejected_sender: { label: "Ignored: not a member", tone: "muted" },
  forwarding_confirmation: { label: "Gmail confirmation", tone: "primary" },
};

type Detail = { code?: string; files?: { name: string; ok: boolean; newRows?: number; message?: string }[] } | null;

function describe(status: string, detail: Detail): string {
  if (status === "forwarding_confirmation" && detail?.code) return `Confirmation code ${detail.code}: enter it in Gmail's forwarding settings.`;
  if (!detail?.files?.length) return "";
  return detail.files.map((f) => (f.ok ? `${f.name}: ${f.newRows ?? 0} new` : `${f.name}: ${f.message ?? "not imported"}`)).join(" · ");
}

/** Settings card: the household's private import address (copy, new address, turn off) and the last emails it got. */
export function EmailImportSettings() {
  const qc = useQueryClient();
  const status = useQuery(orpc.imports.email.get.queryOptions());
  const billing = useQuery(orpc.billing.status.queryOptions());
  const proOnly = billing.data ? !billing.data.limits.emailImport : false;
  const done = (message: string) => (data: unknown) => {
    qc.setQueryData(orpc.imports.email.get.queryKey(), data as typeof status.data);
    toast.success(message);
  };
  const regenerate = useMutation({ mutationFn: () => client.imports.email.regenerate(), onSuccess: done("New address ready"), onError: (e) => toast.error(errorMessage(e)) });
  const disable = useMutation({ mutationFn: () => client.imports.email.disable(), onSuccess: done("Email import turned off"), onError: (e) => toast.error(errorMessage(e)) });
  const s = status.data;
  if (s && !s.available) return null;

  const copy = (address: string) =>
    void navigator.clipboard.writeText(address).then(
      () => toast.success("Address copied"),
      () => window.prompt("Copy this address", address),
    );

  return (
    <Disclosure id="email-import" icon={<Mail />} title="Import by email" description="Forward statement PDFs to a private address" bodyClassName="space-y-3 text-foreground">
      <div>
        <p className="text-muted-foreground">
          Forward Bank Jago monthly statements and GoPay e-statements (PDF) to your household's private address. They are imported right away and you get a summary back.
          Only mail from a member's own email address is read.
        </p>
      </div>
      {status.isError && <p className="text-destructive">{errorMessage(status.error)}</p>}
      {s?.enabled && s.address ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-3">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{s.address}</code>
            <Button size="xs" variant="secondary" className="bg-card" onClick={() => copy(s.address!)}>
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep it private, like a password. Gmail can forward automatically: Settings → Forwarding, add this address; the confirmation code shows up below. Password-protected
            PDFs (BCA, Mandiri) cannot be read by email yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={regenerate.isPending}
              onClick={() => confirm("Make a new address? The current one stops working at once; update any forwarding rules.") && regenerate.mutate()}
            >
              New address
            </Button>
            <Button size="sm" variant="destructive" disabled={disable.isPending} onClick={() => confirm("Turn off email import? Mail to this address will bounce.") && disable.mutate()}>
              Turn off
            </Button>
          </div>
        </>
      ) : s && proOnly ? (
        <ProNotice feature="emailImport" />
      ) : s ? (
        <Button size="sm" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
          {regenerate.isPending ? "Creating…" : "Get an import address"}
        </Button>
      ) : null}
      {!!s?.recent.length && (
        <div className="space-y-1">
          <div className="label">Recent emails</div>
          <ul className="divide-y divide-border">
            {s.recent.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: "muted" as const };
              const text = describe(r.status, r.detail as Detail);
              return (
                <li key={r.id} className="space-y-0.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="min-w-0 truncate">{r.subject || "(no subject)"}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-xs break-words text-muted-foreground">
                    {r.fromAddress}
                    {text && ` · ${text}`}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Disclosure>
  );
}
