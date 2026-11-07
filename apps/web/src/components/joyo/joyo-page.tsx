// Joyo AI, the in-app finance chat (after JoyoRogo's components/joyo/joyo-page.tsx and joyo-chat.tsx). Conversations
// are stored on the server per member and household; the page streams one answer at a time from `joyo.chat`.

import { Button } from "@baroka/ui/components/button";
import { Checkbox } from "@baroka/ui/components/checkbox";
import { Input } from "@baroka/ui/components/input";
import { Select } from "@baroka/ui/components/select";
import { Sheet } from "@baroka/ui/components/sheet";
import { Textarea } from "@baroka/ui/components/textarea";
import { cn } from "@baroka/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, History, MessageSquarePlus, SlidersHorizontal, Sparkles, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { STARTERS } from "@/lib/joyo";
import type { ByokProvider, ByokSettings } from "@/lib/joyo";
import { client, errorMessage, orpc } from "@/lib/orpc";

import { AssistantTurn, UserBubble } from "./message";
import { useJoyoChat } from "./use-joyo-chat";

const MAX_CHARS = 4_000;

/** Distance from the end of the page under which the chat follows new text. */
const FOLLOW_PX = 160;

function nearBottom(): boolean {
  const root = document.documentElement;
  return root.scrollHeight - (window.scrollY + window.innerHeight) < FOLLOW_PX;
}

export function JoyoPage({ conversationId, onConversation }: { conversationId: string | undefined; onConversation: (id: string | undefined) => void }) {
  const [text, setText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [away, setAway] = useState(false);
  const followRef = useRef(true);
  const chat = useJoyoChat({
    conversationId,
    onConversation,
    onAsk: () => {
      setText("");
      followRef.current = true;
    },
  });
  const { status, conversation, messages, live, pendingQuestion, error, busyProposal, byok, streaming, hosted, usingKey, available, capReached, empty, ask, stop, act, newChat } = chat;

  useEffect(() => {
    const onScroll = () => {
      followRef.current = nearBottom();
      setAway(!followRef.current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toBottom = useCallback((smooth = false) => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    // Nothing to follow before the first message: keep the welcome screen at the top.
    if (followRef.current && (messages.length || live !== null || pendingQuestion)) toBottom();
  }, [messages, live, pendingQuestion, toBottom]);

  const router = useRouter();
  const canGoBack = useCanGoBack();
  const back = () => (canGoBack ? router.history.back() : void router.navigate({ to: "/" }));

  return (
    // On desktop the page sits under the 4rem top bar; a full-height page would overflow by that much and scroll.
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 sm:min-h-[calc(100dvh-4rem)]">
      <header className="sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b border-border/60 bg-background/90 px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur sm:top-16 sm:pt-2.5">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" title="Back" className="sm:hidden" onClick={back}>
          <ArrowLeft aria-hidden />
        </Button>
        <span aria-hidden className="hidden size-9 items-center justify-center rounded-full bg-primary-soft text-primary-ink sm:flex">
          <Sparkles className="size-[1.125rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-extrabold tracking-tight">{conversation.data?.title && conversationId ? conversation.data.title : "Joyo AI"}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {usingKey ? `Your ${byok?.provider} key` : hosted ? `${hosted.model}${status.data ? ` · ${status.data.usedToday}/${status.data.dailyCap} today` : ""}` : status.isPending ? " " : "Off on this server"}
            {status.data?.readOnly ? " · Read-only" : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Joyo AI settings" title="Joyo AI settings" onClick={() => setKeyOpen(true)}>
          <SlidersHorizontal aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Conversations" title="Conversations" onClick={() => setHistoryOpen(true)}>
          <History aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={newChat} disabled={empty}>
          <MessageSquarePlus aria-hidden />
        </Button>
      </header>

      <div className="flex-1 space-y-5 py-5 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-40">
        {empty && (
          <div className="space-y-5 pt-4">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">Tanya soal uangmu</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Answers from your own ledger.{" "}
                {status.data?.readOnly ? "Read-only: it explains changes instead of making them." : "It suggests changes; you confirm them."}
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    disabled={!available || capReached}
                    onClick={() => void ask(s.text)}
                    className="h-full w-full rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className="block text-sm font-semibold">{s.text}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
            {conversation.isFetching && conversationId && <p className="text-sm text-muted-foreground">Loading…</p>}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} />
          ) : (
            <AssistantTurn key={m.id} text={m.content} steps={m.steps} proposals={m.proposals} busyProposal={busyProposal} onProposal={(p, a) => void act(m.id, p, a)} />
          ),
        )}
        {pendingQuestion && <UserBubble text={pendingQuestion} />}
        {live && <AssistantTurn text={live.text} steps={live.steps} proposals={live.proposals} streaming />}
        {error && (
          <div role="alert" className="rounded-2xl bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">
            <p>{error.message}</p>
            <button type="button" className="mt-1 font-semibold underline underline-offset-4" onClick={() => void ask(error.retry)}>
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4">
        <div className="mx-auto max-w-3xl">
          {away && (
            <div className="mb-2 flex justify-center">
              <Button type="button" variant="outline" size="xs" onClick={() => toBottom(true)}>
                <ArrowDown aria-hidden /> Latest
              </Button>
            </div>
          )}
          {!available && !status.isPending ? (
            <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm shadow-float">
              Joyo AI is off on this server.{" "}
              <button type="button" className="font-semibold text-primary underline underline-offset-4" onClick={() => setKeyOpen(true)}>
                Use your own API key
              </button>
              .
            </p>
          ) : capReached ? (
            <p className="rounded-3xl border border-border bg-card px-4 py-3 text-sm shadow-float">
              That's all of today's {status.data?.dailyCap} questions. They come back tomorrow, or{" "}
              <button type="button" className="font-semibold text-primary underline underline-offset-4" onClick={() => setKeyOpen(true)}>
                use your own key
              </button>
              {status.data?.plan === "free" && (
                <>
                  {" "}
                  or{" "}
                  <Link to="/pricing" className="font-semibold text-primary underline underline-offset-4">
                    get more with Pro
                  </Link>
                </>
              )}
              .
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(text);
              }}
              className="flex items-end gap-2 rounded-[1.75rem] border border-border bg-card p-1.5 pl-4 shadow-float"
            >
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask(text);
                  }
                }}
                placeholder="Tanya Joyo… (Berapa pengeluaran makan bulan ini?)"
                aria-label="Message Joyo AI"
                rows={1}
                className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-0 py-2.5 focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0"
              />
              {streaming ? (
                <Button type="button" size="icon" variant="secondary" aria-label="Stop" onClick={stop}>
                  <Square className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()}>
                  <ArrowUp aria-hidden />
                </Button>
              )}
            </form>
          )}
          <p className="mt-1.5 hidden text-center text-[0.6875rem] text-muted-foreground sm:block">Joyo can be wrong. It's not financial advice; check the numbers that matter.</p>
        </div>
      </div>

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        current={conversationId}
        onPick={(id) => {
          setHistoryOpen(false);
          chat.pick(id);
        }}
        onDeleted={(id) => id === conversationId && newChat()}
      />
      <KeySheet
        open={keyOpen}
        onOpenChange={setKeyOpen}
        settings={byok}
        onSave={chat.setByok}
        providers={status.data?.byokProviders ?? []}
        hosted={hosted}
        readOnly={status.data?.readOnly ?? false}
      />
    </div>
  );
}

function HistorySheet({
  open,
  onOpenChange,
  current,
  onPick,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string | undefined;
  onPick: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ ...orpc.joyo.conversations.list.queryOptions(), enabled: open });
  const remove = async (id: string) => {
    try {
      await client.joyo.conversations.delete({ id });
      onDeleted(id);
      void qc.invalidateQueries({ queryKey: orpc.joyo.conversations.list.key() });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const rows = list.data?.conversations ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Conversations" description="Only you see these. They're kept until you delete them.">
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <button type="button" onClick={() => onPick(c.id)} className={cn("min-w-0 flex-1 rounded-xl px-2 py-3 text-left hover:bg-muted/60", c.id === current && "bg-primary-soft text-primary-ink")}>
                <span className="block truncate text-sm font-semibold">{c.title}</span>
                <span className="block text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              </button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete "${c.title}"`} onClick={() => void remove(c.id)}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

type ProviderInfo = { id: ByokProvider; label: string; defaultModel: string; suggested: readonly string[]; keyUrl: string | null; keyPlaceholder: string };

function KeySheet({
  open,
  onOpenChange,
  settings,
  onSave,
  providers,
  hosted,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ByokSettings | null;
  onSave: (s: ByokSettings | null) => void;
  providers: readonly ProviderInfo[];
  hosted: { provider: string; model: string } | null;
  readOnly: boolean;
}) {
  const [provider, setProvider] = useState<ByokProvider>(settings?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? "");
  const [model, setModel] = useState(settings?.model ?? "");
  useEffect(() => {
    if (!open) return;
    setProvider(settings?.provider ?? "anthropic");
    setApiKey(settings?.apiKey ?? "");
    setModel(settings?.model ?? "");
  }, [open, settings]);
  const info = providers.find((p) => p.id === provider);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Joyo AI settings"
      description={hosted ? `Your own API key is optional. Without one, Joyo uses JoyoArto's ${hosted.model} with a daily limit.` : "Joyo AI isn't set up on this server: add your own key to use it."}
    >
      <ReadOnlySetting value={readOnly} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(apiKey.trim() ? { provider, apiKey: apiKey.trim(), model: model.trim(), enabled: true } : null);
          onOpenChange(false);
          toast.success(apiKey.trim() ? "Joyo will use your key" : "Key removed");
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="byok-provider" className="text-sm font-semibold">
            Provider
          </label>
          <Select id="byok-provider" value={provider} onValueChange={(v) => setProvider(v as ByokProvider)} items={providers.map((p) => ({ value: p.id, label: p.label }))} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="byok-key" className="text-sm font-semibold">
            API key
          </label>
          <Input id="byok-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={info?.keyPlaceholder ?? ""} />
          {info?.keyUrl && (
            <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline underline-offset-4">
              Get a key
            </a>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="byok-model" className="text-sm font-semibold">
            Model <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input id="byok-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={info?.defaultModel ?? ""} autoComplete="off" spellCheck={false} />
        </div>
        <p className="rounded-2xl bg-muted px-4 py-3 text-xs text-muted-foreground">
          The key stays in this browser. It's sent with each question to JoyoArto's server, which uses it for that call to the provider and never stores or logs it. Your question,
          the conversation and the ledger data Joyo reads go to that provider under its own terms. Not counted in the daily limit.
        </p>
        <div className="flex gap-2">
          {settings && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onSave(null);
                onOpenChange(false);
                toast.success("Key removed");
              }}
            >
              Remove key
            </Button>
          )}
          <Button type="submit" className="flex-1">
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** The member's read-only switch: saved on the server, so the phone app follows it too. */
function ReadOnlySetting({ value }: { value: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (readOnly: boolean) => client.joyo.settings({ readOnly }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: orpc.joyo.status.key() });
      toast.success(r.readOnly ? "Joyo is read-only" : "Joyo can suggest changes again");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const checked = save.isPending && save.variables !== undefined ? save.variables : value;
  return (
    <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-muted px-4 py-3">
      <Checkbox className="mt-0.5" checked={checked} disabled={save.isPending} onCheckedChange={(v) => save.mutate(v)} />
      <span className="space-y-0.5 text-sm">
        <span className="block font-semibold">Read-only</span>
        <span className="block text-muted-foreground">Joyo only reads and explains; it won't suggest changes for you to confirm.</span>
      </span>
    </label>
  );
}
