// Joyo AI's streamed answer on the phone. The web reads `client.joyo.chat(...)` as an oRPC event iterator, but oRPC's
// fetch adapter decodes the body with TextDecoderStream and TransformStream, which Hermes (React Native's engine) does
// not have. So the phone calls the same procedure through its REST route, POST /api/joyo/chat (server-sent events,
// plain JSON per event), with expo/fetch, whose Response.body is a real stream on Android and iOS, and decodes the
// events here: UTF-8 by hand (TextDecoder when the engine has it) and SSE framing like @orpc/standard-server's
// EventDecoder. Pure (fetch is passed in), unit-tested.

import type { Proposal, Step } from "@baroka/api/lib/joyo-ai/tools";
import type { JoyoStreamEvent } from "@baroka/api/routers/joyo";
import type { StoredMessage } from "@baroka/api/services/joyo";

import type { FetchLike } from "./api";

export type { Proposal, Step };

/** A stored message as it arrives in JSON (dates are strings over REST, Date objects over oRPC). */
export type ChatMessage = Omit<StoredMessage, "createdAt"> & { createdAt: Date | string };

/** The stream's events with JSON dates. */
export type ChatStreamEvent =
  | Exclude<JoyoStreamEvent, { type: "start" } | { type: "done" }>
  | { type: "start"; conversationId: string; userMessage: ChatMessage }
  | { type: "done"; message: ChatMessage; usedToday: number; dailyCap: number };

export type ByokInput = { provider: "anthropic" | "openrouter" | "openai"; apiKey: string; model?: string };

export type ChatInput = { message: string; conversationId?: string; byok?: ByokInput };

// ------------------------------------------------------------------------------------------------ UTF-8

/** Bytes to text across chunk boundaries: a character split between two network chunks waits for the rest. */
export function createUtf8Decoder(native: boolean = typeof TextDecoder !== "undefined") {
  if (native) {
    const d = new TextDecoder("utf-8");
    return { decode: (bytes: Uint8Array, stream = true) => d.decode(bytes, { stream }) };
  }
  let pending: number[] = [];
  return {
    decode(bytes: Uint8Array, stream = true): string {
      const all = pending.length ? [...pending, ...bytes] : Array.from(bytes);
      pending = [];
      let out = "";
      let i = 0;
      while (i < all.length) {
        const b = all[i]!;
        const need = b < 0x80 ? 0 : b >> 5 === 0b110 ? 1 : b >> 4 === 0b1110 ? 2 : b >> 3 === 0b11110 ? 3 : -1;
        if (need < 0) {
          out += "�";
          i++;
          continue;
        }
        // Not all of this character's bytes are here yet.
        if (i + need >= all.length) {
          if (stream) {
            pending = all.slice(i);
            break;
          }
          out += "�";
          break;
        }
        let cp = need === 0 ? b : b & (0xff >> (need + 2));
        let bad = false;
        for (let k = 1; k <= need; k++) {
          const c = all[i + k]!;
          if (c >> 6 !== 0b10) {
            bad = true;
            break;
          }
          cp = (cp << 6) | (c & 0x3f);
        }
        if (bad) {
          out += "�";
          i++;
          continue;
        }
        out += String.fromCodePoint(cp);
        i += need + 1;
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------------------------------------ SSE framing

export type SseMessage = { event?: string; data?: string; id?: string };

/** Server-sent events from text chunks. Comments (keep-alives) are dropped. */
export function createSseDecoder() {
  let buffer = "";
  const parse = (block: string): SseMessage | null => {
    const msg: SseMessage = {};
    let any = false;
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? "" : line.slice(line.charCodeAt(i + 1) === 32 ? i + 2 : i + 1);
      if (field === "data") msg.data = msg.data === undefined ? value : `${msg.data}\n${value}`;
      else if (field === "event") msg.event = value;
      else if (field === "id") msg.id = value;
      else continue;
      any = true;
    }
    return any ? msg : null;
  };
  return {
    feed(chunk: string): SseMessage[] {
      buffer += chunk;
      const out: SseMessage[] = [];
      for (;;) {
        const m = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
        if (!m) break;
        const block = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const msg = parse(block);
        if (msg) out.push(msg);
      }
      return out;
    },
    /** What is left when the body ends (a last event without its blank line). */
    end(): SseMessage[] {
      const rest = buffer;
      buffer = "";
      const msg = rest.trim() ? parse(rest) : null;
      return msg ? [msg] : [];
    },
  };
}

// ------------------------------------------------------------------------------------------------ errors

/** An error the screens can read like an oRPC error (src/lib/errors.ts is duck-typed on code/status/data). */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

function errorFrom(json: unknown, status: number): ChatError {
  const e = (json ?? {}) as { code?: unknown; status?: unknown; message?: unknown; data?: unknown };
  const code = typeof e.code === "string" ? e.code : status === 401 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR";
  const st = typeof e.status === "number" ? e.status : status;
  const message = typeof e.message === "string" && e.message ? e.message : `Server error ${st}`;
  const data = e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : undefined;
  return new ChatError(message, code, st, data);
}

const tryJson = (s: string | undefined): unknown => {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** One SSE message as a chat event, an error that ends the stream, or the end itself. */
export function readSse(msg: SseMessage): { kind: "event"; event: ChatStreamEvent } | { kind: "error"; error: ChatError } | { kind: "done" } | null {
  if (msg.event === "error") return { kind: "error", error: errorFrom(tryJson(msg.data), 500) };
  if (msg.event === "done") return { kind: "done" };
  if (msg.event !== undefined && msg.event !== "message") return null;
  const json = tryJson(msg.data) as { type?: unknown } | undefined;
  if (!json || typeof json.type !== "string") return null;
  return { kind: "event", event: json as ChatStreamEvent };
}

// ------------------------------------------------------------------------------------------------ the request

type BodyReader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> };

const HEADERS_TIMEOUT_MS = 30_000;

/**
 * Asks Joyo and calls `onEvent` for every event as it arrives. Resolves when the answer is done; rejects with a
 * ChatError (the server's code, status, message and data: `reason: "off" | "cap"`, `upgrade`), a network TypeError,
 * or an AbortError after `signal` fired.
 */
export async function streamJoyoChat(opts: {
  server: string;
  token: string;
  input: ChatInput;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
  onEvent: (e: ChatStreamEvent) => void;
}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener?.("abort", abort);
  // Only waiting for the first byte is timed: an answer that reads many tools can take a minute or more.
  const timer = setTimeout(abort, HEADERS_TIMEOUT_MS);
  let reader: BodyReader | null = null;
  try {
    const res = await opts.fetchImpl(`${opts.server.replace(/\/+$/, "")}/api/joyo/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(opts.input),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw errorFrom(tryJson(await res.text()), res.status);

    const sse = createSseDecoder();
    const utf8 = createUtf8Decoder();
    let finished = false;
    const handle = (messages: SseMessage[]) => {
      for (const m of messages) {
        const r = readSse(m);
        if (!r) continue;
        if (r.kind === "error") throw r.error;
        if (r.kind === "done") finished = true;
        else {
          opts.onEvent(r.event);
          if (r.event.type === "done") finished = true;
        }
      }
    };

    const body = res.body as unknown as { getReader?: () => BodyReader } | null;
    if (body?.getReader) {
      reader = body.getReader();
      for (;;) {
        if (controller.signal.aborted) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) handle(sse.feed(utf8.decode(value, true)));
        if (finished) break;
      }
      handle(sse.feed(utf8.decode(new Uint8Array(0), false)));
    } else {
      // No streaming body (an old fetch): the whole answer at once, still correct.
      handle(sse.feed(await res.text()));
    }
    if (!finished) handle(sse.end());
    if (!finished) throw new ChatError("The answer was cut off. Try again.", "STREAM_ENDED", 0);
  } catch (e) {
    if (controller.signal.aborted && !(e instanceof ChatError)) throw abortError();
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener?.("abort", abort);
    if (reader?.cancel) void reader.cancel().catch(() => undefined);
  }
}

function abortError() {
  const e = new Error("Stopped.");
  e.name = "AbortError";
  return e;
}

// ------------------------------------------------------------------------------------------------ the chat's state

export type LiveStep = Step & { running?: boolean };
export type Live = { text: string; steps: LiveStep[]; proposals: Proposal[] };

/** What the chat screen shows: stored messages, the answer being written, and the question waiting for its start. */
export type ChatView = {
  conversationId: string | undefined;
  messages: ChatMessage[];
  live: Live | null;
  pending: string | null;
  usage: { usedToday: number; dailyCap: number } | null;
};

export const EMPTY_CHAT: ChatView = { conversationId: undefined, messages: [], live: null, pending: null, usage: null };

export type ChatAction =
  | { type: "ask"; question: string }
  | { type: "event"; event: ChatStreamEvent }
  /** The stream ended (done, stopped or failed): nothing is live any more. */
  | { type: "settled" }
  | { type: "open"; conversationId: string | undefined; messages: ChatMessage[] }
  | { type: "proposal"; messageId: string; proposal: Proposal };

/** The web's joyo-page.tsx event handling, as a reducer. */
export function chatReducer(s: ChatView, a: ChatAction): ChatView {
  switch (a.type) {
    case "ask":
      return { ...s, pending: a.question, live: { text: "", steps: [], proposals: [] } };
    case "settled":
      return { ...s, live: null, pending: null };
    case "open":
      return { ...EMPTY_CHAT, conversationId: a.conversationId, messages: a.messages, usage: s.usage };
    case "proposal":
      return {
        ...s,
        messages: s.messages.map((m) => (m.id === a.messageId ? { ...m, proposals: m.proposals.map((p) => (p.id === a.proposal.id ? a.proposal : p)) } : m)),
      };
    case "event": {
      const e = a.event;
      const live = s.live;
      switch (e.type) {
        case "start":
          return {
            ...s,
            conversationId: e.conversationId,
            pending: null,
            messages: s.messages.some((m) => m.id === e.userMessage.id) ? s.messages : [...s.messages, e.userMessage],
          };
        case "round":
          // Text before a tool call was a preamble: the next round writes the answer.
          return live && e.round > 0 ? { ...s, live: { ...live, text: "" } } : s;
        case "text":
          return live ? { ...s, live: { ...live, text: live.text + e.delta } } : s;
        case "toolStart":
          return live ? { ...s, live: { ...live, steps: [...live.steps, { ...e.step, running: true }] } } : s;
        case "toolDone":
          return live ? { ...s, live: { ...live, steps: live.steps.map((x) => (x.id === e.step.id ? { ...e.step, running: false } : x)) } } : s;
        case "proposal":
          return live ? { ...s, live: { ...live, proposals: [...live.proposals, e.proposal] } } : s;
        case "done":
          return { ...s, live: null, pending: null, messages: [...s.messages, e.message], usage: { usedToday: e.usedToday, dailyCap: e.dailyCap } };
      }
    }
  }
  return s;
}
