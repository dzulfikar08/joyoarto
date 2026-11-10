// Settings → Data & privacy: allow or withdraw AI use of your data, download your data, see and disconnect AI apps,
// delete the household, delete the account.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@baroka/ui/components/button";
import { Disclosure } from "@baroka/ui/components/disclosure";
import { ShieldCheck } from "lucide-react";
import { Input } from "@baroka/ui/components/input";

import { AiConsentText, setAiConsent } from "@/lib/ai-consent";
import { authClient } from "@/lib/auth-client";
import { PRODUCT_NAME } from "@/lib/brand";
import { client, errorMessage, orpc, queryClient } from "@/lib/orpc";

const date = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString() : "–");

function save(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DataPrivacySettings() {
  return (
    <Disclosure id="data-privacy" icon={<ShieldCheck />} title="Data & privacy" description="Download or delete your data" bodyClassName="space-y-5 text-foreground">
      <div>
        <span className="text-xs text-muted-foreground">
          <Link to="/privasi" className="underline">
            Privacy policy
          </Link>{" "}
          ·{" "}
          <Link to="/syarat" className="underline">
            Terms
          </Link>
        </span>
      </div>
      <AiConsentSetting />
      <DownloadData />
      <ConnectedApps />
      <DeleteHousehold />
      <DeleteAccount />
    </Disclosure>
  );
}

/** Whether JoyoArto may send the member's data to the AI providers (lib/ai-consent.tsx; same wording as the dialog). */
function AiConsentSetting() {
  const q = useQuery(orpc.account.aiConsent.queryOptions());
  const change = useMutation({ mutationFn: (allow: boolean) => setAiConsent(allow) });
  const allowed = q.data?.allowed === true;
  return (
    <div className="space-y-2">
      <div className="label">Joyo AI and your data</div>
      <p className="text-muted-foreground">
        {allowed && q.data?.at
          ? `Allowed on ${date(q.data.at)}. Joyo AI chat, voice notes, receipt scans and quick add send data to Anthropic and Cloudflare Workers AI.`
          : "Not allowed: nothing is sent to an AI. Joyo AI chat, voice notes and receipt scans ask first; quick add reads your text without AI."}
      </p>
      <Disclosure plain title="What is sent, and to whom">
        <AiConsentText />
      </Disclosure>
      {q.data && (
        <Button
          size="sm"
          variant={allowed ? "secondary" : "default"}
          disabled={change.isPending}
          onClick={() => {
            if (allowed && !confirm("Stop sending data to AI? Joyo AI chat, voice notes and receipt scans stop working until you allow it again.")) return;
            change.mutate(!allowed);
          }}
        >
          {allowed ? "Withdraw" : "Allow"}
        </Button>
      )}
      {(q.error ?? change.error) && <p className="text-destructive">{errorMessage(q.error ?? change.error)}</p>}
    </div>
  );
}

function DownloadData() {
  const json = useMutation({ mutationFn: () => client.account.export(), onSuccess: save });
  const csv = useMutation({ mutationFn: () => client.account.exportTransactionsCsv(), onSuccess: save });
  const error = json.error ?? csv.error;
  return (
    <div className="space-y-2">
      <div className="label">Download your data</div>
      <p className="text-muted-foreground">
        Everything about you and the active household (profile, accounts, transactions, categories, rules, budgets, imports, saved plan scenarios, tokens, connected apps, AI activity
        log, your Joyo AI conversations and AI usage counts) as JSON, or just the transactions as CSV for a spreadsheet.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={json.isPending} onClick={() => json.mutate()}>
          {json.isPending ? "Preparing…" : "Download all (JSON)"}
        </Button>
        <Button size="sm" variant="secondary" disabled={csv.isPending} onClick={() => csv.mutate()}>
          {csv.isPending ? "Preparing…" : "Transactions (CSV)"}
        </Button>
      </div>
      {error && <p className="text-destructive">{errorMessage(error)}</p>}
    </div>
  );
}

/** How much an AI app may do, from what the member approved. */
function accessLabel(a: { scopes: string[]; readOnly: boolean }): string {
  if (!a.scopes.some((s) => s.startsWith("finance:"))) return "no finance access";
  return a.readOnly ? "read-only" : "read and make changes";
}

function ConnectedApps() {
  const qc = useQueryClient();
  const apps = useQuery(orpc.account.connections.queryOptions());
  const disconnect = useMutation({
    mutationFn: (clientId: string) => client.account.disconnect({ clientId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.account.connections.key() }),
  });
  const list = apps.data?.connections ?? [];
  return (
    <div className="space-y-2">
      <div className="label">Connected AI apps</div>
      {apps.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No AI app is connected. API tokens (Claude Code, scripts) are listed under API tokens.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((a) => (
            <li key={a.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">{accessLabel(a)}</span>
              <span className="text-xs text-muted-foreground">connected {date(a.connectedAt)}</span>
              {a.lastAuthorizedAt && <span className="text-xs text-muted-foreground">last refreshed {date(a.lastAuthorizedAt)}</span>}
              <button
                type="button"
                className="ml-auto text-xs text-destructive hover:underline"
                disabled={disconnect.isPending}
                onClick={() => confirm(`Disconnect ${a.name}? It loses access to ${PRODUCT_NAME} right away.`) && disconnect.mutate(a.clientId)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      {(apps.error ?? disconnect.error) && <p className="text-destructive">{errorMessage(apps.error ?? disconnect.error)}</p>}
    </div>
  );
}

function DeleteHousehold() {
  const info = useQuery(orpc.household.get.queryOptions());
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => client.household.delete({ confirmName: typed }),
    onSuccess: () => {
      setOpen(false);
      setTyped("");
      void queryClient.invalidateQueries();
    },
  });
  const h = info.data;
  if (!h) return null;
  const name = h.household.name;
  const others = h.members.length - 1;

  if (h.yourRole !== "owner") {
    return (
      <div className="space-y-1">
        <div className="label">Household data</div>
        <p className="text-muted-foreground">
          Only an owner can delete <b>{name}</b>. You can leave it under Household above; its data stays with the other members.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="label">Delete household data</div>
      {del.isSuccess && (
        <p className="rounded-xl bg-positive-soft p-2 text-positive-ink">
          Deleted {del.data.name} ({del.data.transactionsDeleted} transactions).
        </p>
      )}
      {!open ? (
        <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
          Delete {name}…
        </Button>
      ) : (
        <form
          className="space-y-2 rounded-2xl border border-destructive/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            del.mutate();
          }}
        >
          <p>
            This permanently deletes <b>{name}</b> and everything in it: accounts, transactions, categories, rules, budgets, tags, imports and invites.
            {others > 0 && ` ${others} other member${others > 1 ? "s" : ""} will lose access too.`} It cannot be undone; download your data first if you want a copy.
          </p>
          <label className="block">
            <span className="text-xs text-muted-foreground">Type the household's name to confirm: {name}</span>
            <Input className="mt-1 h-10 px-3 sm:text-sm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" className="bg-destructive text-primary-foreground hover:bg-destructive/90" disabled={typed.trim() !== name.trim() || del.isPending}>
              {del.isPending ? "Deleting…" : "Delete household permanently"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {del.isError && <p className="text-destructive">{errorMessage(del.error)}</p>}
        </form>
      )}
    </div>
  );
}

function DeleteAccount() {
  const me = useQuery(orpc.me.queryOptions());
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const preview = useQuery({ ...orpc.account.deletionPreview.queryOptions(), enabled: open });
  const del = useMutation({
    mutationFn: () => client.account.delete({ confirmEmail: typed }),
    onSuccess: async () => {
      // The user and its sessions are gone; clear the cookies and everything cached in this tab.
      await authClient.signOut().catch(() => undefined);
      queryClient.clear();
      location.assign("/");
    },
  });
  const email = me.data?.user.email ?? "";
  const p = preview.data;
  const blocked = (p?.blocking.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      <div className="label">Delete my account</div>
      {!open ? (
        <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <form
          className="space-y-2 rounded-2xl border border-destructive/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            del.mutate();
          }}
        >
          <p>
            Deletes your {PRODUCT_NAME} account, sign-in sessions, API tokens, AI connections and AI activity log, and signs you out. It cannot be undone.
          </p>
          {me.data?.demo && (
            <p className="text-muted-foreground">
              Demo account: the demo is shared by app reviewers, so instead of being removed for good its made-up data is reset and you are signed out. A real
              account is deleted permanently.
            </p>
          )}
          {preview.isLoading && <p className="text-muted-foreground">Checking your households…</p>}
          {p && (
            <ul className="list-disc space-y-1 pl-5">
              {p.deleted.map((h) => (
                <li key={h.id}>
                  <b>{h.name}</b>: you are its only member, so it is deleted with all its data.
                </li>
              ))}
              {p.left.map((h) => (
                <li key={h.id}>
                  <b>{h.name}</b>: you leave it; its data stays with the other {h.members - 1} member{h.members > 2 ? "s" : ""}.
                </li>
              ))}
              {p.blocking.map((h) => (
                <li key={h.id} className="text-destructive">
                  <b>{h.name}</b>: you are its only owner and it has other members. Switch to it, make another member an owner (or delete the household), then come
                  back.
                </li>
              ))}
            </ul>
          )}
          {!blocked && (
            <>
              <label className="block">
                <span className="text-xs text-muted-foreground">Type your email to confirm: {email}</span>
                <Input className="mt-1 h-10 px-3 sm:text-sm" type="email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  type="submit"
                  className="bg-destructive text-primary-foreground hover:bg-destructive/90"
                  disabled={!p || typed.trim().toLowerCase() !== email.toLowerCase() || del.isPending}
                >
                  {del.isPending ? "Deleting…" : "Delete my account permanently"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {blocked && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          )}
          {(del.error ?? preview.error) && <p className="text-destructive">{errorMessage(del.error ?? preview.error)}</p>}
        </form>
      )}
    </div>
  );
}
