import { schema } from "@baroka/db";
import { ORPCError, eventIterator } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { readProcedure, writeProcedure } from "../index";
import type { Context, Principal } from "../context";
import { todayWib } from "../lib/dashboard";
import { EventChannel } from "../lib/event-channel";
import { byokEngine, engineLabel, hostedEngine, runChat } from "../lib/joyo-ai/chat";
import type { ChatEvent, Engine } from "../lib/joyo-ai/chat";
import { CHAT_LIMITS, reserveSlot, settleSlot, usedToday } from "../lib/joyo-ai/limits";
import { chatCap, upgradeRequired } from "../services/billing";
import { BYOK_PROVIDERS, PROVIDERS } from "../lib/joyo-ai/providers";
import { resultLine, runProposal } from "../lib/joyo-ai/tools";
import { AiError } from "../lib/joyo-ai/types";
import type { AiErrorKind } from "../lib/joyo-ai/types";
import * as capture from "../services/capture";
import * as joyo from "../services/joyo";
import type { StoredMessage } from "../services/joyo";

/** A member's own key gets a generous ceiling too: it still runs tools on JoyoArto's server. */
const BYOK_DAILY_CAP = 300;

const chatInput = z.object({
  conversationId: z.string().min(1).max(64).optional().describe("Continue this conversation; absent = start a new one"),
  message: z.string().trim().min(1).max(CHAT_LIMITS.messageChars),
  /**
   * The member's own key, for this question only: used for the provider call and never stored or logged. The model's
   * provider is fixed by `provider` (no custom URLs).
   */
  byok: z
    .object({
      provider: z.enum(BYOK_PROVIDERS),
      apiKey: z.string().trim().min(10).max(400),
      model: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export type JoyoStreamEvent =
  | { type: "start"; conversationId: string; userMessage: StoredMessage }
  | ChatEvent
  | { type: "done"; message: StoredMessage; usedToday: number; dailyCap: number };

/** What the member is told for a failure, by kind. Provider messages are never passed on (they can quote the prompt). */
const FAILURE: Partial<Record<AiErrorKind, string>> & { server: string } = {
  timeout: "Joyo took too long to answer. Try a narrower question.",
  empty: "Joyo had no answer this time. Try asking again.",
  truncated: "Joyo ran out of room before answering. Try a narrower question.",
  rateLimit: "The AI provider is busy. Try again in a minute.",
  network: "Couldn't reach the AI provider. Try again.",
  refused: "Joyo can't help with that one.",
  badKey: "Your API key was refused. Check it in Joyo AI settings.",
  quota: "Your API key has no credit left.",
  modelNotFound: "That model isn't available with your key. Pick another in Joyo AI settings.",
  noTools: "That model can't use tools. Pick another one in Joyo AI settings.",
  server: "Joyo AI had a problem. Try again in a moment.",
};

function failureMessage(kind: AiErrorKind, engine: Engine): string {
  // The hosted key's own problems are JoyoArto's to fix; the member only sees a generic line.
  if (engine.kind === "hosted" && (kind === "badKey" || kind === "quota" || kind === "modelNotFound" || kind === "forbidden" || kind === "noTools")) return FAILURE.server;
  return FAILURE[kind] ?? FAILURE.server;
}

async function personOf(context: Context & { principal: Principal }) {
  const [u] = await context.db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, context.principal.userId));
  const [h] = await context.db.select({ name: schema.household.name }).from(schema.household).where(eq(schema.household.id, context.principal.householdId));
  const { readOnly } = await joyo.getJoyoSettings(context.db, context.principal);
  return { name: u?.name?.split(/\s+/)[0] ?? null, household: h?.name ?? null, today: todayWib(), readOnly };
}

export const joyoRouter = {
  status: readProcedure.route({ method: "GET", path: "/joyo/status", tags: ["joyo"], summary: "Whether Joyo AI is on, its model and today's usage" }).handler(async ({ context }) => {
    const engine = hostedEngine(context.ai);
    const serverCap = context.ai?.dailyCap ?? 0;
    const { cap, plan } = await chatCap(context.db, context.principal.userId, context.billing, serverCap);
    return {
      hosted: engine && serverCap > 0 ? { provider: engine.provider, model: engine.conn.model } : null,
      usedToday: await usedToday(context.db, context.principal.userId, ["chat"], "hosted"),
      dailyCap: cap,
      /** free: the hosted cap is Free's; Pro gets the server's (JOYO_AI_DAILY_CAP). */
      plan,
      voice: !!context.ai && (!!context.ai.workersAi || context.ai.fakeTranscript),
      /** The member's Joyo AI read-only setting in this household (joyo.settings). */
      readOnly: (await joyo.getJoyoSettings(context.db, context.principal)).readOnly,
      byokProviders: BYOK_PROVIDERS.map((id) => ({ id, label: PROVIDERS[id].label, defaultModel: PROVIDERS[id].defaultModel, suggested: PROVIDERS[id].suggested, keyUrl: PROVIDERS[id].keyUrl, keyPlaceholder: PROVIDERS[id].keyPlaceholder })),
    };
  }),

  /**
   * Read-only: Joyo AI only reads and explains. It is offered no write tools (nothing to confirm), and confirming a
   * proposal from before is refused while it is on. Per member and household, so the web and the phone agree.
   */
  settings: writeProcedure
    .route({ method: "PUT", path: "/joyo/settings", tags: ["joyo"], summary: "Set your Joyo AI settings (read-only) in the active household" })
    .input(joyo.joyoSettingsInput)
    .handler(({ context, input }) => joyo.setJoyoSettings(context.db, context.principal, input)),

  conversations: {
    list: readProcedure
      .route({ method: "GET", path: "/joyo/conversations", tags: ["joyo"], summary: "Your Joyo AI conversations in the active household, newest first" })
      .handler(({ context }) => joyo.listConversations(context.db, context.principal)),
    get: readProcedure
      .route({ method: "GET", path: "/joyo/conversations/{id}", tags: ["joyo"] })
      .input(joyo.conversationIdInput)
      .handler(({ context, input }) => joyo.getConversation(context.db, context.principal, input.id)),
    delete: readProcedure
      .route({ method: "DELETE", path: "/joyo/conversations/{id}", tags: ["joyo"] })
      .input(joyo.conversationIdInput)
      .handler(({ context, input }) => joyo.deleteConversation(context.db, context.principal, input.id)),
  },

  /**
   * One question, streamed. The history comes from the stored conversation (the client sends only the new message).
   * Errors before the first event: SERVICE_UNAVAILABLE `{ reason: "off" }`, TOO_MANY_REQUESTS `{ reason: "cap" }`.
   * A failure after the stream started ends it with an ORPCError whose message is for the member. The hosted engine
   * takes a slot of the daily cap before the model runs; the ledger keeps counts and tokens, never text.
   */
  chat: readProcedure
    .route({ method: "POST", path: "/joyo/chat", tags: ["joyo"], summary: "Ask Joyo AI (server-sent events: start, round, text, toolStart, toolDone, proposal, done)" })
    .input(chatInput)
    .output(eventIterator(z.custom<JoyoStreamEvent>()))
    .handler(async function* ({ context, input, signal }) {
      const { db, principal } = context;
      const hosted = hostedEngine(context.ai);
      const serverCap = context.ai?.dailyCap ?? 0;
      const engine = input.byok ? byokEngine(input.byok, context.ai?.effort) : hosted;
      if (!engine || (engine.kind === "hosted" && serverCap === 0)) {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Joyo AI is off on this server. Add your own key in Joyo AI settings to use it.", data: { reason: "off" } });
      }

      const conversationId = input.conversationId
        ? (await joyo.getConversationRow(db, principal, input.conversationId)).id
        : await joyo.createConversation(db, principal, input.message);
      const history = await joyo.historyOf(db, conversationId);
      // A retry after a failed answer: the question is already the last turn, so it is not stored twice.
      const lastTurn = history.at(-1);
      const userMessage = lastTurn?.role === "user" && lastTurn.content === input.message ? lastTurn : await joyo.appendMessage(db, conversationId, { role: "user", content: input.message });
      if (userMessage !== lastTurn) history.push(userMessage);

      const { cap, plan } = engine.kind === "hosted" ? await chatCap(db, principal.userId, context.billing, serverCap) : { cap: serverCap, plan: "pro" as const };
      const slot = await reserveSlot(db, {
        userId: principal.userId,
        householdId: principal.householdId,
        kind: "chat",
        engine: engine.kind,
        model: engineLabel(engine).slice(0, 120),
        cap: engine.kind === "hosted" ? cap : BYOK_DAILY_CAP,
      });
      if (!slot) {
        if (engine.kind === "hosted" && plan === "free" && cap < serverCap) {
          upgradeRequired("joyoAi", `That's all of today's ${cap} Joyo AI questions on Free. They come back tomorrow (WIB), or add your own key.`, { reason: "cap", cap });
        }
        throw new ORPCError("TOO_MANY_REQUESTS", { message: `That's all of today's ${cap} Joyo AI questions. They come back tomorrow (WIB).`, data: { reason: "cap", cap } });
      }

      yield { type: "start", conversationId, userMessage } satisfies JoyoStreamEvent;

      const channel = new EventChannel<JoyoStreamEvent>();
      const stop = new AbortController();
      signal?.addEventListener("abort", () => stop.abort(), { once: true });
      const started = Date.now();
      const tally = { calls: 0, inputTokens: 0, outputTokens: 0 };
      let settled = false;
      const settle = (outcome: string) => {
        if (settled) return;
        settled = true;
        const p = settleSlot(db, slot, { outcome, ...tally, latencyMs: Date.now() - started }).catch((e: unknown) => console.error("[joyo] ledger update failed", e instanceof Error ? e.name : e));
        if (context.ai?.waitUntil) context.ai.waitUntil(p);
      };

      const drive = async () => {
        try {
          const person = await personOf({ ...context, principal });
          const answer = await runChat({
            engine,
            context,
            person,
            turns: history.map((h) => ({ role: h.role, content: h.content })),
            signal: stop.signal,
            onEvent: (event) => channel.push(event),
            tally,
          });
          const message = await joyo.appendMessage(db, conversationId, {
            role: "assistant",
            content: answer.reply,
            steps: answer.steps,
            proposals: answer.proposals,
            model: engineLabel(engine).slice(0, 120),
          });
          settle("ok");
          const used = engine.kind === "hosted" ? await usedToday(db, principal.userId, ["chat"], "hosted") : 0;
          channel.push({ type: "done", message, usedToday: used, dailyCap: cap });
          channel.close();
        } catch (error) {
          const kind: AiErrorKind = error instanceof AiError ? error.kind : "server";
          // Kind and status only: a provider's message can quote the prompt, and a member's key must never be logged.
          if (kind !== "aborted") console.error("[joyo] failed", engine.kind, error instanceof AiError ? `${error.kind} ${error.status ?? ""}` : error instanceof Error ? error.name : typeof error);
          settle(kind);
          channel.fail(new ORPCError(kind === "rateLimit" ? "TOO_MANY_REQUESTS" : "UNPROCESSABLE_CONTENT", { message: failureMessage(kind, engine), data: { reason: kind } }));
        }
      };
      void drive();

      try {
        yield* channel;
      } finally {
        stop.abort();
        settle("aborted");
      }
    }),

  /**
   * Confirm or dismiss a change Joyo proposed. Confirming runs the stored proposal (never arguments from the client)
   * through the same procedure as the REST API, with the caller's own permissions.
   */
  proposal: writeProcedure
    .route({ method: "POST", path: "/joyo/proposals", tags: ["joyo"], summary: "Confirm or dismiss a change Joyo AI proposed" })
    .input(z.object({ messageId: z.string().min(1).max(64), proposalId: z.string().min(1).max(64), action: z.enum(["confirm", "dismiss"]) }))
    .handler(async ({ context, input }) => {
      const message = await joyo.ownMessage(context.db, context.principal, input.messageId);
      const proposal = message.proposals.find((p) => p.id === input.proposalId);
      if (!proposal) throw new ORPCError("NOT_FOUND", { message: "That suggestion is gone." });
      if (proposal.status === "done" || proposal.status === "dismissed") return { proposal };
      if (input.action === "dismiss") proposal.status = "dismissed";
      else if ((await joyo.getJoyoSettings(context.db, context.principal)).readOnly) {
        throw new ORPCError("FORBIDDEN", { message: "Joyo AI is read-only. Turn off Read-only in Joyo's menu to make this change, or make it yourself in the app.", data: { reason: "readOnly" } });
      } else {
        try {
          const result = await runProposal(proposal, context);
          proposal.status = "done";
          proposal.result = resultLine(proposal.tool, result);
        } catch (error) {
          proposal.status = "failed";
          proposal.result = error instanceof ORPCError ? error.message.slice(0, 300) : "Couldn't make this change.";
          if (!(error instanceof ORPCError)) console.error("[joyo] proposal failed", proposal.tool, error instanceof Error ? error.name : typeof error);
        }
      }
      await joyo.saveProposals(context.db, message.id, message.proposals);
      return { proposal };
    }),
};

/** The add-transaction sheet: voice note to text, text to a draft the member reviews. Neither saves anything. */
export const captureRouter = {
  transcribe: writeProcedure
    .route({ method: "POST", path: "/capture/transcribe", tags: ["transactions"], summary: "Voice note to text (multipart/form-data: audio); nothing is stored" })
    .input(capture.transcribeInput)
    .handler(({ context, input }) => capture.transcribe(context.db, context.principal, context.ai, input)),
  parse: writeProcedure
    .route({ method: "POST", path: "/capture/parse", tags: ["transactions"], summary: "Free text (\"kopi 25rb gopay\") to a transaction draft to review; saves nothing" })
    .input(capture.parseInput)
    .handler(({ context, input }) => capture.parseCapture(context.db, context.principal, context.ai, input)),
  receipt: writeProcedure
    .route({
      method: "POST",
      path: "/capture/receipt",
      tags: ["transactions"],
      summary: "Receipt photo to a transaction draft (multipart/form-data: image); the photo is kept as an unattached receipt, the draft is not saved",
      description:
        "Save the reviewed draft with POST /transactions/quick and attachmentIds: [attachment.id]. ocr.status is ok, off (no AI on this server), cap (today's receipts are used; ocr.upgrade on Free) or failed; the photo is kept in every case.",
    })
    .input(capture.receiptInput)
    .handler(({ context, input }) => capture.receiptCapture(context.db, context.principal, context.ai, context.files, context.billing, input)),
};
