import { describe, expect, test } from "bun:test";

import { AiError } from "../types";
import { buildAnthropicParams, replyOf, toWireMessages } from "./anthropic";

describe("anthropic adapter", () => {
  test("params: cached system prompt, effort, server-side fallback on Opus 5.5", () => {
    const p = buildAnthropicParams({ model: "claude-opus-5-5", system: "S", messages: [{ role: "user", content: "hi" }], maxTokens: 100, effort: "low" });
    expect(p.system).toEqual([{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(buildAnthropicParams({ model: "claude-haiku-5-5", system: "S", messages: [], maxTokens: 1 }).fallbacks).toBeUndefined();
  });

  test("a tool round's own blocks are replayed unchanged, and results ride in one user turn", () => {
    const raw = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "a", name: "list_accounts", input: {} },
      { type: "tool_use", id: "b", name: "cashflow", input: {} },
    ];
    const wire = toWireMessages([
      { role: "user", content: "q" },
      { role: "assistant", content: "", toolCalls: [], raw },
      { role: "tool", callId: "a", name: "list_accounts", content: "1" },
      { role: "tool", callId: "b", name: "cashflow", content: "2" },
    ]);
    expect(wire).toHaveLength(3);
    expect(wire[1]!.content).toBe(raw as never);
    expect((wire[2]!.content as unknown[]).length).toBe(2);
  });

  test("reply: tool calls, usage with cache reads, refusal", () => {
    const r = replyOf({
      content: [
        { type: "text", text: "Let me look", citations: null },
        { type: "tool_use", id: "t", name: "cashflow", input: { months: 6 }, caller: { type: "direct" } },
      ] as never,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } as never,
    });
    expect(r.toolCalls).toEqual([{ id: "t", name: "cashflow", args: { months: 6 } }]);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 3 });
    expect(() => replyOf({ content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } as never })).toThrow(AiError);
  });
});
