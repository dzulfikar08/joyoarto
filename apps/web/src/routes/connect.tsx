import { useQuery } from "@tanstack/react-query";
import { Button, buttonVariants } from "@baroka/ui/components/button";
import { Skeleton } from "@baroka/ui/components/skeleton";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, Check, Eye, PencilLine } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { BrandMark, Wordmark } from "@/components/kit";

import { sessionQuery } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { grantedScopes, offersAccessChoice, parseOAuthRequest, readOAuthQuery } from "@/lib/oauth-query";
import type { AccessChoice } from "@/lib/oauth-query";

export const Route = createFileRoute("/connect")({ component: Connect });

type PublicClient = { client_name?: string; client_uri?: string };

const ACCESS_OPTIONS: { value: AccessChoice; title: string; text: string; icon: typeof Eye }[] = [
  { value: "read", title: "Read only (recommended)", text: "Read your accounts, transactions, budgets and reports. It cannot change anything.", icon: Eye },
  { value: "write", title: "Read and make changes", text: "Also add and import transactions, set categories, rules and budgets.", icon: PencilLine },
];

const SCOPE_TEXT: Record<string, string> = {
  "finance:read": "Read your accounts, transactions, budgets and reports",
  "finance:write": "Add and import transactions, set categories, rules and budgets",
  offline_access: "Stay connected without asking again (you can disconnect any time)",
};

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-center">
          <Wordmark />
        </div>
        <div className="space-y-4 rounded-3xl bg-card p-6 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

/** Login and consent page of the MCP connector: the auth server sends the AI app's authorization request here. */
function Connect() {
  const request = parseOAuthRequest(readOAuthQuery());
  const session = useQuery(sessionQuery);
  if (!request.ok) {
    return (
      <Card>
        <h1 className="text-xl font-extrabold tracking-tight">{request.reason === "expired" ? "This request expired" : "Invalid connection request"}</h1>
        <p className="text-sm text-muted-foreground">Start connecting again from your AI app.</p>
      </Card>
    );
  }
  if (session.isPending)
    return (
      <Card>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-12 w-full rounded-full" />
      </Card>
    );
  if (!session.data) {
    return (
      <Card>
        <h1 className="text-xl font-extrabold tracking-tight">Connect an AI app to JoyoArto</h1>
        <p className="text-sm text-muted-foreground">Sign in first; you will choose what it may do next.</p>
        <Link to="/login" search={{ redirect: `/connect?${request.query}` }} className={buttonVariants({ className: "w-full" })}>
          Sign in
        </Link>
      </Card>
    );
  }
  return <Consent request={request} email={session.data.user.email} />;
}

function Consent({ request, email }: { request: Extract<ReturnType<typeof parseOAuthRequest>, { ok: true }>; email: string }) {
  const [busy, setBusy] = useState(false);
  const choice = offersAccessChoice(request.scopes);
  const [access, setAccess] = useState<AccessChoice>("read");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const client = useQuery({
    queryKey: ["oauth-public-client", request.clientId],
    queryFn: async () => {
      const { data, error: e } = await authClient.$fetch<PublicClient>("/oauth2/public-client", { query: { client_id: request.clientId } });
      if (e || !data) throw new Error(e?.message ?? "client");
      return data;
    },
    retry: false,
  });

  const submit = async (accept: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const { data, error: e } = await authClient.$fetch<{ url?: string }>("/oauth2/consent", {
      method: "POST",
      // Read only approves the requested scopes without finance:write, so the token itself lacks it.
      body: { accept, oauth_query: request.query, ...(accept && grantedScopes(request.scopes, access) ? { scope: grantedScopes(request.scopes, access) } : {}) },
    });
    if (e || !data?.url) {
      setError("This request expired or was already used. Start connecting again from your AI app.");
      setBusy(false);
      inFlight.current = false;
      return;
    }
    window.location.assign(data.url);
  };

  const name = client.data?.client_name?.trim() || "An AI app";
  return (
    <Card>
      <div className="flex items-center gap-3" aria-hidden>
        <span className="grid size-11 place-items-center rounded-2xl bg-muted text-lg font-extrabold text-foreground">
          {client.isPending ? "" : name.charAt(0).toUpperCase()}
        </span>
        <ArrowLeftRight className="size-4 text-muted-foreground" />
        <BrandMark className="size-11" />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-balance">{name} wants to connect to JoyoArto</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-semibold break-all text-foreground">{email}</span>. After you allow it, you will return to{" "}
        <span className="font-semibold break-all text-foreground">{request.redirectHost}</span>.
      </p>
      {choice ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">What may it do?</legend>
          {ACCESS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-4 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 ${
                access === o.value ? "border-primary bg-primary/5" : "border-border bg-muted hover:border-muted-foreground/40"
              }`}
            >
              <input type="radio" name="access" value={o.value} checked={access === o.value} onChange={() => setAccess(o.value)} className="sr-only" />
              <o.icon className={`mt-0.5 size-4 shrink-0 ${access === o.value ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
              <span className="space-y-0.5">
                <span className="block font-semibold text-foreground">{o.title}</span>
                <span className="block text-muted-foreground">{o.text}</span>
              </span>
            </label>
          ))}
          {request.scopes.includes("offline_access") && <p className="text-xs text-muted-foreground">{SCOPE_TEXT.offline_access}.</p>}
        </fieldset>
      ) : (
        <ul className="space-y-2.5 rounded-2xl bg-muted p-4 text-sm">
          {request.scopes.map((s) => (
            <li key={s} className="flex gap-2.5">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-positive-soft text-positive-ink">
                <Check className="size-3.5" strokeWidth={3} aria-hidden />
              </span>
              {SCOPE_TEXT[s] ?? s}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-ink">
          {error}
        </p>
      )}
      <div className="flex gap-2.5">
        <Button className="flex-1" disabled={busy || client.isPending} onClick={() => void submit(true)}>
          Allow
        </Button>
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void submit(false)}>
          Deny
        </Button>
      </div>
    </Card>
  );
}
