// Joyo AI as a side panel (the Plan page): a compact chat that sends what the page shows with every question and hands
// the plans Joyo runs back to the page, so the scenarios, chart and checks change while the member talks to it.

import { Button } from "@baroka/ui/components/button";
import { Textarea } from "@baroka/ui/components/textarea";
import { cn } from "@baroka/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowUp, MessageSquarePlus, Sparkles, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AssistantTurn, UserBubble } from "./message";
import { useJoyoChat } from "./use-joyo-chat";
import type { PageContext, PlanEvent } from "./use-joyo-chat";

const MAX_CHARS = 4_000;
const CONVERSATION_KEY = "baroka.plan.joyo";

export type Starter = { text: string; hint?: string };

export function JoyoPanel({
  title,
  intro,
  starters,
  page,
  onPlan,
  onClose,
  className,
}: {
  title: string;
  intro: string;
  starters: readonly Starter[];
  page: () => PageContext;
  onPlan: (event: PlanEvent) => void;
  onClose?: () => void;
  className?: string;
}) {
  // The panel's conversation survives a reload of the page in this tab, not across tabs.
  const [conversationId, setConversationId] = useState<string | undefined>(() => sessionStorage.getItem(CONVERSATION_KEY) ?? undefined);
  useEffect(() => {
    if (conversationId) sessionStorage.setItem(CONVERSATION_KEY, conversationId);
    else sessionStorage.removeItem(CONVERSATION_KEY);
  }, [conversationId]);

  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useJoyoChat({ conversationId, onConversation: setConversationId, page, onPlan, onAsk: () => setText("") });
  const { status, messages, live, pendingQuestion, error, busyProposal, streaming, available, capReached, empty, ask, stop, act, newChat } = chat;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live, pendingQuestion]);

  return (
    <aside aria-label={title} className={cn("flex min-h-0 flex-col overflow-hidden rounded-3xl bg-card", className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary-ink">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {status.data ? `${status.data.usedToday}/${status.data.dailyCap} today` : " "}
            {status.data?.readOnly ? " · Read-only" : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={newChat} disabled={empty}>
          <MessageSquarePlus aria-hidden />
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Joyo AI" title="Close" onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {empty && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{intro}</p>
            <ul className="space-y-2">
              {starters.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    disabled={!available || capReached}
                    onClick={() => void ask(s.text)}
                    className="w-full rounded-2xl border border-border px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className="block font-semibold">{s.text}</span>
                    {s.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} />
          ) : (
            <AssistantTurn key={m.id} text={m.content} steps={m.steps} proposals={m.proposals} busyProposal={busyProposal} onProposal={(p, a) => act(m.id, p, a)} />
          ),
        )}
        {pendingQuestion && <UserBubble text={pendingQuestion} />}
        {live && <AssistantTurn text={live.text} steps={live.steps} proposals={live.proposals} streaming />}
        {error && (
          <div role="alert" className="rounded-2xl bg-destructive-soft px-3.5 py-3 text-sm text-destructive-ink">
            <p>{error.message}</p>
            <button type="button" className="mt-1 font-semibold underline underline-offset-4" onClick={() => void ask(error.retry)}>
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-border p-2.5">
        {!available && !status.isPending ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">
            Joyo AI is off on this server.{" "}
            <Link to="/joyo" className="font-semibold text-primary underline underline-offset-4">
              Use your own key
            </Link>
          </p>
        ) : capReached ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">That's all of today's {status.data?.dailyCap} questions. They come back tomorrow.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
            className="flex items-end gap-2 rounded-2xl bg-muted/60 p-1 pl-3"
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
              placeholder="Ask Joyo to change the plan…"
              aria-label="Message Joyo AI"
              rows={1}
              className="max-h-32 min-h-10 resize-none border-0 bg-transparent px-0 py-2 text-sm focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0"
            />
            {streaming ? (
              <Button type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={stop}>
                <Square className="size-3.5" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" aria-label="Send" disabled={!text.trim()}>
                <ArrowUp aria-hidden />
              </Button>
            )}
          </form>
        )}
        <p className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground">Not financial advice; check the numbers that matter.</p>
      </div>
    </aside>
  );
}
