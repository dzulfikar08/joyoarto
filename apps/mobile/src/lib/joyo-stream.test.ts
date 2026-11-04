import { describe, expect, test } from "bun:test";

import {
  chatReducer,
  ChatError,
  createSseDecoder,
  createUtf8Decoder,
  EMPTY_CHAT,
  readSse,
  streamJoyoChat,
  type ChatMessage,
  type ChatStreamEvent,
} from "./joyo-stream";

const enc = new TextEncoder();

describe("UTF-8 across chunks (no TextDecoder on Hermes)", () => {
  for (const native of [false, true]) {
    test(native ? "native TextDecoder" : "hand-written decoder", () => {
      const text = "Rp 25.000 · kopi ☕ — naïve 𝄞 done";
      const bytes = enc.encode(text);
      const d = createUtf8Decoder(native);
      let out = "";
      // One byte at a time splits every multi-byte character.
      for (const b of bytes) out += d.decode(new Uint8Array([b]), true);
      out += d.decode(new Uint8Array(0), false);
      expect(out).toBe(text);
    });
  }

  test("bad bytes become U+FFFD instead of throwing", () => {
    const d = createUtf8Decoder(false);
    expect(d.decode(new Uint8Array([0x61, 0xff, 0x62]), false)).toBe("a�b");
    expect(createUtf8Decoder(false).decode(new Uint8Array([0xe2, 0x82]), false)).toBe("�");
  });
});

describe("SSE framing", () => {
  test("events split anywhere, keep-alive comments, multi-line data, CRLF", () => {
    const wire = ': keep-alive\n\nevent: message\ndata: {"type":"text","delta":"Halo"}\n\nevent: message\r\ndata: {"type":"text",\r\ndata: "delta":" lagi"}\r\n\r\nevent: done\n\n';
    const d = createSseDecoder();
    const got = [];
    for (let i = 0; i < wire.length; i += 7) got.push(...d.feed(wire.slice(i, i + 7)));
    got.push(...d.end());
    expect(got).toEqual([
      { event: "message", data: '{"type":"text","delta":"Halo"}' },
      { event: "message", data: '{"type":"text",\n"delta":" lagi"}' },
      { event: "done" },
    ]);
  });

  test("a last event without its blank line still counts at the end", () => {
    const d = createSseDecoder();
    expect(d.feed('event: message\ndata: {"type":"round","round":0}')).toEqual([]);
    expect(d.end()).toEqual([{ event: "message", data: '{"type":"round","round":0}' }]);
  });

  test("readSse: events, errors, done, junk", () => {
    expect(readSse({ event: "message", data: '{"type":"text","delta":"x"}' })).toEqual({ kind: "event", event: { type: "text", delta: "x" } });
    expect(readSse({ data: '{"type":"round","round":1}' })).toEqual({ kind: "event", event: { type: "round", round: 1 } });
    expect(readSse({ event: "done" })).toEqual({ kind: "done" });
    expect(readSse({ event: "message", data: "not json" })).toBeNull();
    const err = readSse({ event: "error", data: '{"defined":false,"code":"UNPROCESSABLE_CONTENT","status":422,"message":"Joyo took too long to answer.","data":{"reason":"timeout"}}' });
    expect(err?.kind).toBe("error");
    const e = (err as { error: ChatError }).error;
    expect([e.code, e.status, e.message, e.data?.reason]).toEqual(["UNPROCESSABLE_CONTENT", 422, "Joyo took too long to answer.", "timeout"]);
  });
});

const userMessage: ChatMessage = { id: "m1", role: "user", content: "Berapa makan bulan ini?", steps: [], proposals: [], model: null, createdAt: "2026-11-04T01:00:00.000Z" };
const answer: ChatMessage = {
  id: "m2",
  role: "assistant",
  content: "Rp 2.400.000",
  steps: [{ id: "s1", tool: "spending_summary", title: "Spending", args: { month: "2026-11" }, ok: true }],
  proposals: [],
  model: "claude",
  createdAt: "2026-11-04T01:00:05.000Z",
};

function sseBody(events: (ChatStreamEvent | { error: object } | "done")[], chunk = 11): ReadableStream<Uint8Array> {
  const wire = events
    .map((e) => (e === "done" ? "event: done\n\n" : "error" in e ? `event: error\ndata: ${JSON.stringify(e.error)}\n\n` : `event: message\ndata: ${JSON.stringify(e)}\n\n`))
    .join(": \n\n");
  const bytes = enc.encode(wire);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

describe("streamJoyoChat", () => {
  const events: ChatStreamEvent[] = [
    { type: "start", conversationId: "c1", userMessage },
    { type: "round", round: 0 },
    { type: "toolStart", step: { id: "s1", tool: "spending_summary", title: "Spending", args: { month: "2026-11" }, ok: true } },
    { type: "toolDone", step: { id: "s1", tool: "spending_summary", title: "Spending", args: { month: "2026-11" }, ok: true } },
    { type: "round", round: 1 },
    { type: "text", delta: "Rp 2.400" },
    { type: "text", delta: ".000 ☕" },
    { type: "done", message: answer, usedToday: 3, dailyCap: 30 },
  ];

  test("posts to the REST route with the bearer and delivers every event in order", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const got: ChatStreamEvent[] = [];
    await streamJoyoChat({
      server: "https://app.example/",
      token: "sess_x",
      input: { message: "Berapa makan bulan ini?", byok: { provider: "anthropic", apiKey: "sk-ant-xxxxxxxxxx" } },
      fetchImpl: async (url, init) => {
        calls.push({ url, init: init! });
        return new Response(sseBody([...events, "done"]), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
      onEvent: (e) => got.push(e),
    });
    expect(calls[0]!.url).toBe("https://app.example/api/joyo/chat");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sess_x");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ message: "Berapa makan bulan ini?", byok: { provider: "anthropic", apiKey: "sk-ant-xxxxxxxxxx" } });
    expect(got).toEqual(events);
    // And the reducer turns them into the screen's state.
    let view = chatReducer(EMPTY_CHAT, { type: "ask", question: "Berapa makan bulan ini?" });
    const seen: (typeof view)[] = [];
    for (const e of got) {
      view = chatReducer(view, { type: "event", event: e });
      seen.push(view);
    }
    expect(seen[0]!.pending).toBeNull();
    expect(seen[0]!.conversationId).toBe("c1");
    expect(seen[2]!.live?.steps[0]?.running).toBe(true);
    expect(seen[3]!.live?.steps[0]?.running).toBe(false);
    expect(seen[6]!.live?.text).toBe("Rp 2.400.000 ☕");
    expect(view.live).toBeNull();
    expect(view.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(view.usage).toEqual({ usedToday: 3, dailyCap: 30 });
  });

  test("an error before the stream: the server's code, message and reason", async () => {
    const off = await streamJoyoChat({
      server: "https://x",
      token: "t",
      input: { message: "hi" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ defined: false, code: "SERVICE_UNAVAILABLE", status: 503, message: "Joyo AI is off on this server.", data: { reason: "off" } }), { status: 503 }),
      onEvent: () => undefined,
    }).catch((e: unknown) => e);
    expect(off).toBeInstanceOf(ChatError);
    expect((off as ChatError).code).toBe("SERVICE_UNAVAILABLE");
    expect((off as ChatError).data?.reason).toBe("off");
  });

  test("an error event in the middle ends it after the events before", async () => {
    const got: ChatStreamEvent[] = [];
    const err = await streamJoyoChat({
      server: "https://x",
      token: "t",
      input: { message: "hi" },
      fetchImpl: async () => new Response(sseBody([events[0]!, { error: { code: "TOO_MANY_REQUESTS", status: 429, message: "The AI provider is busy.", data: { reason: "rateLimit" } } }]), { status: 200 }),
      onEvent: (e) => got.push(e),
    }).catch((e: unknown) => e);
    expect(got).toHaveLength(1);
    expect((err as ChatError).message).toBe("The AI provider is busy.");
    expect((err as ChatError).status).toBe(429);
  });

  test("a body that ends early is an error, not a silent success", async () => {
    const err = await streamJoyoChat({
      server: "https://x",
      token: "t",
      input: { message: "hi" },
      fetchImpl: async () => new Response(sseBody([events[0]!, events[5]!]), { status: 200 }),
      onEvent: () => undefined,
    }).catch((e: unknown) => e);
    expect((err as ChatError).code).toBe("STREAM_ENDED");
  });

  test("works without a streaming body (whole text at once)", async () => {
    const got: ChatStreamEvent[] = [];
    const text = await new Response(sseBody([...events, "done"])).text();
    await streamJoyoChat({
      server: "https://x",
      token: "t",
      input: { message: "hi" },
      fetchImpl: async () => ({ ok: true, status: 200, body: null, text: async () => text }) as unknown as Response,
      onEvent: (e) => got.push(e),
    });
    expect(got).toEqual(events);
  });

  test("Stop aborts with an AbortError", async () => {
    const stop = new AbortController();
    const err = await streamJoyoChat({
      server: "https://x",
      token: "t",
      input: { message: "hi" },
      signal: stop.signal,
      fetchImpl: async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(events[0])}\n\n`));
            init?.signal?.addEventListener("abort", () => c.error(new Error("aborted")));
          },
        });
        return new Response(body, { status: 200 });
      },
      onEvent: () => stop.abort(),
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
  });
});

describe("chatReducer", () => {
  test("a round after a tool clears the preamble; proposals are added and updated", () => {
    let v = chatReducer(EMPTY_CHAT, { type: "ask", question: "Kategorikan Grab" });
    v = chatReducer(v, { type: "event", event: { type: "text", delta: "Let me check." } });
    v = chatReducer(v, { type: "event", event: { type: "round", round: 1 } });
    expect(v.live?.text).toBe("");
    const proposal = { id: "p1", tool: "categorize", title: "Categorise", summary: "3 Grab rides → transport/ride-hailing", args: {}, status: "pending" as const };
    v = chatReducer(v, { type: "event", event: { type: "proposal", proposal } });
    expect(v.live?.proposals).toEqual([proposal]);
    v = chatReducer(v, { type: "event", event: { type: "done", message: { ...answer, proposals: [proposal] }, usedToday: 1, dailyCap: 5 } });
    v = chatReducer(v, { type: "proposal", messageId: "m2", proposal: { ...proposal, status: "done", result: "3 changed" } });
    expect(v.messages.at(-1)?.proposals[0]?.status).toBe("done");
  });

  test("settled after a failure drops the live answer and the waiting question", () => {
    let v = chatReducer(EMPTY_CHAT, { type: "ask", question: "hi" });
    v = chatReducer(v, { type: "settled" });
    expect([v.live, v.pending]).toEqual([null, null]);
  });

  test("opening a conversation replaces the messages and keeps today's usage", () => {
    const v = chatReducer({ ...EMPTY_CHAT, usage: { usedToday: 2, dailyCap: 5 }, messages: [answer] }, { type: "open", conversationId: "c9", messages: [userMessage] });
    expect(v).toEqual({ ...EMPTY_CHAT, conversationId: "c9", messages: [userMessage], usage: { usedToday: 2, dailyCap: 5 } });
  });

  test("the start event does not duplicate a retried question", () => {
    const v = chatReducer({ ...EMPTY_CHAT, messages: [userMessage] }, { type: "event", event: { type: "start", conversationId: "c1", userMessage } });
    expect(v.messages).toHaveLength(1);
  });
});
