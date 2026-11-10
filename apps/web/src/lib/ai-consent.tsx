// Asking before any of the member's data goes to an AI (App Review 5.1.1(i) / 5.1.2(i); server:
// packages/api/src/services/ai-consent.ts). Joyo AI chat, voice notes and receipt scans await `ensureAiConsent()` first;
// the server refuses them without consent anyway (PRECONDITION_FAILED `{ aiConsent: true }`). Typed quick add asks once
// per page load and falls back to the rules parser on the server without consent. Withdraw: Settings → Data & privacy.
// Phone: apps/mobile/src/lib/ai-consent.ts (same wording). One dialog for the app, mounted in __root.

import { Button } from "@baroka/ui/components/button";
import { Dialog } from "@baroka/ui/components/dialog";
import { Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { client, errorMessage, orpc, queryClient } from "./orpc";

export const AI_CONSENT_TITLE = "Allow Joyo AI to use your data?";

/** What is sent, to whom, and what happens to it. */
export const AI_CONSENT_LINES = [
  "Joyo AI chat sends your question and the household data needed to answer it (transactions, balances, accounts, categories, budgets and plans).",
  "Voice notes send the recording; receipt scans send the photo; quick add sends the text you typed.",
  "It goes to Anthropic (the maker of Claude) and Cloudflare Workers AI, which run the AI for JoyoArto. If you added your own AI key, Joyo AI chat goes to that provider instead.",
  "They process it only to answer you and do not use it to train their models. JoyoArto never sells your data.",
  "Nothing is sent until you allow it. You can withdraw this any time in Settings → Data & privacy.",
] as const;

let pending: ((ok: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function finish(ok: boolean) {
  const resolve = pending;
  pending = null;
  notify();
  resolve?.(ok);
}

async function allowed(): Promise<boolean> {
  return (await queryClient.fetchQuery({ ...orpc.account.aiConsent.queryOptions(), staleTime: 60_000 })).allowed;
}

export async function setAiConsent(allow: boolean): Promise<void> {
  const res = await client.account.setAiConsent({ allow });
  queryClient.setQueryData(orpc.account.aiConsent.queryKey(), res);
  void queryClient.invalidateQueries({ queryKey: orpc.joyo.status.key() });
}

/** True when the member has allowed AI (asking now if not yet); false on "Not now". */
export async function ensureAiConsent(): Promise<boolean> {
  try {
    if (await allowed()) return true;
  } catch {
    // Can't tell: ask. The server checks again anyway.
  }
  if (pending) finish(false);
  return new Promise<boolean>((resolve) => {
    pending = resolve;
    notify();
  });
}

let askedThisLoad = false;

/** Typed quick add: asks at most once per page load and never blocks (the server reads it without AI then). */
export async function askAiConsentOnce(): Promise<void> {
  if (askedThisLoad) return;
  askedThisLoad = true;
  await ensureAiConsent();
}

/** True when the error is the server's "allow AI first" refusal. */
export function isAiConsentError(e: unknown): boolean {
  const data = (e as { data?: { aiConsent?: unknown } } | null)?.data;
  return !!data && data.aiConsent === true;
}

export function AiConsentText() {
  return (
    <div className="space-y-2 text-sm text-pretty">
      {AI_CONSENT_LINES.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

export function AiConsentDialog() {
  const open = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending !== null,
    () => false,
  );
  const [saving, setSaving] = useState(false);
  const allow = async () => {
    setSaving(true);
    try {
      await setAiConsent(true);
      finish(true);
    } catch (e) {
      toast.error("Couldn't save that", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish(false)} title={AI_CONSENT_TITLE} closeLabel="Not now">
      <AiConsentText />
      <p className="mt-3 text-sm">
        <Link to="/privasi" hash="pihak-lain" target="_blank" className="text-primary underline">
          Privacy policy: who processes your data
        </Link>
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => finish(false)}>
          Not now
        </Button>
        <Button onClick={() => void allow()} disabled={saving}>
          Allow
        </Button>
      </div>
    </Dialog>
  );
}
