import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@baroka/ui/components/button";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Input } from "@baroka/ui/components/input";

import { Avatar } from "@/components/avatar";
import { PageHeader, ThemeSwitch } from "@/components/kit";

import { requireSession, signOut } from "@/lib/auth";
import { SITE_URL } from "@/lib/brand";
import { SERVER_URL, client, errorMessage, orpc } from "@/lib/orpc";

import { ProNotice } from "@/components/upgrade";

import { BillingSettings } from "./-billing";
import { DataPrivacySettings } from "./-data-privacy";
import { EmailImportSettings } from "./-email-import";
import { HouseholdSettings } from "./-household";
import { ReimburseSettings } from "./-reimburse-settings";

export const Route = createFileRoute("/settings")({ beforeLoad: requireSession, component: Settings });

function Settings() {
  const qc = useQueryClient();
  const me = useQuery(orpc.me.queryOptions());
  const tokens = useQuery(orpc.tokens.list.queryOptions());
  const billing = useQuery(orpc.billing.status.queryOptions());
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const create = useMutation({
    mutationFn: () => client.tokens.create({ name: name.trim(), scopes: readOnly ? ["finance:read"] : ["finance:read", "finance:write"] }),
    onSuccess: () => {
      setName("");
      toast.success("Token created. Copy it now; it is not shown again.");
      void qc.invalidateQueries({ queryKey: orpc.tokens.list.key() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.tokens.revoke({ id }),
    onSuccess: () => {
      toast.success("Token revoked");
      void qc.invalidateQueries({ queryKey: orpc.tokens.list.key() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const mcpUrl = `${SERVER_URL}/mcp`;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <section className="card flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <Avatar name={me.data?.user.name} image={me.data?.user.image} className="size-11" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="label">Signed in</div>
          <div className="break-words">
            {me.data ? `${me.data.user.name} · ${me.data.user.email}` : me.isError ? errorMessage(me.error) : "…"}
          </div>
        </div>
        <Button size="sm" variant="secondary" className="sm:hidden" onClick={() => void signOut()}>
          Sign out
        </Button>
      </section>

      <HouseholdSettings />

      <BillingSettings />

      <EmailImportSettings />

      <ReimburseSettings />

      <section className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <h2 className="text-base font-bold tracking-tight">Appearance</h2>
          <p className="text-muted-foreground">Light, dark, or follow this device.</p>
        </div>
        <ThemeSwitch />
      </section>

      <section className="card space-y-3 text-sm">
        <h2 className="text-base font-bold tracking-tight">Connect Claude</h2>
        {billing.data && !billing.data.limits.mcpConnector && <ProNotice feature="mcpConnector" />}
        <p>
          <b>claude.ai / Claude Desktop:</b> Customize → Connectors → Add custom connector, URL <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs break-all">{mcpUrl}</code>. You
          sign in and approve here. What Claude sees and how to disconnect:{" "}
          <a className="text-primary underline" href={`${SITE_URL}/claude`} target="_blank" rel="noreferrer">
            the connector guide
          </a>
          .
        </p>
        <p>
          <b>Claude Code:</b> create a token below, then run
        </p>
        <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">{`claude mcp add --transport http joyoarto ${mcpUrl} \\
  --header "Authorization: Bearer brk_..."`}</pre>
        <p>
          <b>REST API:</b>{" "}
          <a className="break-all text-primary underline" href={`${SERVER_URL}/api/docs`} target="_blank" rel="noreferrer">
            {SERVER_URL}/api/docs
          </a>{" "}
          with the same token.
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-bold tracking-tight">API tokens</h2>
        {create.data && (
          <div className="space-y-1 rounded-2xl bg-warning-soft p-3 text-sm text-warning-ink">
            <div>Copy it now; it is not shown again:</div>
            <code className="block font-mono text-xs break-all text-foreground">{create.data.token}</code>
          </div>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input className="h-10 flex-1 basis-full px-3 sm:basis-64 sm:text-sm" aria-label="Token name" placeholder="Token name (e.g. Claude Code laptop)" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <Checkbox checked={readOnly} onCheckedChange={setReadOnly} /> read-only
          </label>
          <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Creating…" : "Create token"}
          </Button>
        </form>
        {tokens.isError && <p className="text-sm text-destructive">{errorMessage(tokens.error)}</p>}
        {tokens.data && !tokens.data.tokens.length && <p className="text-sm text-muted-foreground">No tokens yet. Create one for Claude Code, a script or an iOS Shortcut.</p>}
        <ul className="divide-y divide-border text-sm">
          {tokens.data?.tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-semibold">{t.name}</span>
              <code className="text-xs text-muted-foreground">{t.prefix}…</code>
              <span className="text-xs text-muted-foreground">{t.readOnly ? "read-only" : "read and write"}</span>
              <span className="text-xs text-muted-foreground">{t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}</span>
              <button
                type="button"
                className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive-soft"
                disabled={revoke.isPending}
                onClick={() => confirm(`Revoke "${t.name}"? Anything using it stops working.`) && revoke.mutate(t.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>

      <DataPrivacySettings />
    </div>
  );
}
