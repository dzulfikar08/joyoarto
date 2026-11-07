// One Joyo AI conversation in the browser: the stored messages, the answer being streamed from `joyo.chat`, proposals
// and the member's own key. Shared by the full Joyo AI page and the panel beside the Plan page (which also sends what
// the page shows and receives the plans Joyo runs).

import type { Proposal, Step } from "@baroka/api/lib/joyo-ai/tools";
import type { JoyoStreamEvent } from "@baroka/api/routers/joyo";
import type { StoredMessage } from "@baroka/api/services/joyo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { byokInput, loadByok, saveByok } from "@/lib/joyo";
import type { ByokSettings } from "@/lib/joyo";
import type { ChatAttachmentIn } from "@/lib/joyo-attachments";
import { client, errorMessage, orpc } from "@/lib/orpc";

export type LiveStep = Step & { running?: boolean };
export type Live = { text: string; steps: LiveStep[]; proposals: Proposal[] };
export type PlanEvent = Extract<JoyoStreamEvent, { type: "plan" }>;
export type PageContext = { kind: "plan"; state: Record<string, unknown> };

export function useJoyoChat({
  conversationId,
  onConversation,
  page,
  onPlan,
  onAsk,
}: {
  conversationId: string | undefined;
  onConversation: (id: string | undefined) => void;
  /** Read when a question is sent: what the page beside the chat shows. */
  page?: () => PageContext;
  /** A plan Joyo ran while answering, for the page to show. */
  onPlan?: (event: PlanEvent) => void;
  onAsk?: () => void;
}) {
  const qc = useQueryClient();
  const status = useQuery(orpc.joyo.status.queryOptions());
  const conversation = useQuery({ ...orpc.joyo.conversations.get.queryOptions({ input: { id: conversationId ?? "" } }), enabled: !!conversationId });
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retry: string; attachments?: ChatAttachmentIn[] } | null>(null);
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const [byok, setByokState] = useState<ByokSettings | null>(loadByok);
  const abortRef = useRef<AbortController | null>(null);
  // The conversation this chat created itself while streaming: its fetch must not replace the live state.
  const ownIdRef = useRef<string | undefined>(undefined);
  const onPlanRef = useRef(onPlan);
  onPlanRef.current = onPlan;

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (conversation.data && conversation.data.id === conversationId && ownIdRef.current !== conversationId) setMessages(conversation.data.messages);
  }, [conversationId, conversation.data]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const streaming = live !== null;
  const hosted = status.data?.hosted ?? null;
  const usingKey = !!byokInput(byok);
  const available = usingKey || hosted !== null;
  const capReached = !usingKey && !!status.data && status.data.dailyCap > 0 && status.data.usedToday >= status.data.dailyCap;

  const ask = async (question: string, attachments: readonly ChatAttachmentIn[] = []) => {
    const q = question.trim();
    if (!q || streaming) return;
    setError(null);
    // Shown until the server echoes the stored question (which keeps the file names the same way).
    setPendingQuestion(attachments.length ? `${q}\n\n📎 ${attachments.map((a) => a.name).join(", ")}` : q);
    setLive({ text: "", steps: [], proposals: [] });
    onAsk?.();
    const controller = new AbortController();
    abortRef.current = controller;
    let started: string | undefined = conversationId;
    try {
      const key = byokInput(byok);
      const ctx = page?.();
      const events = await client.joyo.chat(
        {
          message: q,
          ...(conversationId ? { conversationId } : {}),
          ...(key ? { byok: key } : {}),
          ...(ctx ? { page: ctx } : {}),
          ...(attachments.length ? { attachments: [...attachments] } : {}),
        },
        { signal: controller.signal },
      );
      for await (const raw of events) {
        const event = raw as JoyoStreamEvent;
        switch (event.type) {
          case "start":
            started = event.conversationId;
            if (!conversationId) {
              ownIdRef.current = event.conversationId;
              onConversation(event.conversationId);
            }
            setMessages((m) => (m.some((x) => x.id === event.userMessage.id) ? m : [...m, event.userMessage]));
            setPendingQuestion(null);
            break;
          case "round":
            // Text before a tool call was a preamble: the next call writes the answer.
            setLive((l) => (l && event.round > 0 ? { ...l, text: "" } : l));
            break;
          case "text":
            setLive((l) => (l ? { ...l, text: l.text + event.delta } : l));
            break;
          case "toolStart":
            setLive((l) => (l ? { ...l, steps: [...l.steps, { ...event.step, running: true }] } : l));
            break;
          case "toolDone":
            setLive((l) => (l ? { ...l, steps: l.steps.map((s) => (s.id === event.step.id ? { ...event.step, running: false } : s)) } : l));
            break;
          case "proposal":
            setLive((l) => (l ? { ...l, proposals: [...l.proposals, event.proposal] } : l));
            break;
          case "plan":
            onPlanRef.current?.(event);
            break;
          case "done":
            setMessages((m) => [...m, event.message]);
            setLive(null);
            void qc.invalidateQueries({ queryKey: orpc.joyo.status.key() });
            void qc.invalidateQueries({ queryKey: orpc.joyo.conversations.list.key() });
            break;
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError({ message: errorMessage(err), retry: q, attachments: [...attachments] });
      else if (started) void qc.invalidateQueries({ queryKey: orpc.joyo.conversations.get.key({ input: { id: started } }) });
    } finally {
      setLive(null);
      setPendingQuestion(null);
      abortRef.current = null;
      void qc.invalidateQueries({ queryKey: orpc.joyo.status.key() });
    }
  };

  const stop = () => abortRef.current?.abort();

  const proposal = useMutation({
    mutationFn: (v: { messageId: string; proposal: Proposal; action: "confirm" | "dismiss" }) =>
      client.joyo.proposal({ messageId: v.messageId, proposalId: v.proposal.id, action: v.action }),
    onMutate: (v) => setBusyProposal(v.proposal.id),
    onSuccess: (res, v) => {
      setMessages((m) => m.map((msg) => (msg.id === v.messageId ? { ...msg, proposals: msg.proposals.map((p) => (p.id === v.proposal.id ? res.proposal : p)) } : msg)));
      if (res.proposal.status === "done") {
        toast.success(res.proposal.result ?? "Done");
        for (const key of [orpc.transactions.key(), orpc.reports.key(), orpc.accounts.key(), orpc.plan.key(), orpc.rules.key(), orpc.reimburse.key(), orpc.budgets.key(), orpc.categories.key()]) {
          void qc.invalidateQueries({ queryKey: key });
        }
      } else if (res.proposal.status === "failed") toast.error(res.proposal.result ?? "Couldn't make this change");
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setBusyProposal(null),
  });
  const act = (messageId: string, p: Proposal, action: "confirm" | "dismiss") => proposal.mutate({ messageId, proposal: p, action });

  const newChat = () => {
    if (streaming) stop();
    ownIdRef.current = undefined;
    setMessages([]);
    setError(null);
    onConversation(undefined);
  };

  /** Switch to a stored conversation (from the history list). */
  const pick = (id: string) => {
    ownIdRef.current = undefined;
    onConversation(id);
  };

  const setByok = (s: ByokSettings | null) => {
    setByokState(s);
    saveByok(s);
  };

  return {
    status,
    conversation,
    messages,
    live,
    pendingQuestion,
    error,
    busyProposal,
    byok,
    setByok,
    streaming,
    hosted,
    usingKey,
    available,
    capReached,
    empty: messages.length === 0 && !streaming && !pendingQuestion,
    ask,
    stop,
    act,
    newChat,
    pick,
  };
}
