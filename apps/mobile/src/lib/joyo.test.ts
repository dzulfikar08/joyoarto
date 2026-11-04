import { describe, expect, test } from "bun:test";

import { argLine, availability, byokInput, chatErrorMessage, maskKey, parseByok, stepsLabel, toolWords } from "./joyo";

const status = { hosted: { provider: "claude", model: "claude-sonnet-5-5" }, usedToday: 2, dailyCap: 5, plan: "free" as const };

describe("tool chips", () => {
  test("reading while a tool runs, then the count", () => {
    expect(stepsLabel([], true)).toBeNull();
    expect(stepsLabel([{ tool: "spending_summary" }, { tool: "budget_status", running: true }], true)).toBe("Reading budgets…");
    expect(stepsLabel([{ tool: "spending_summary" }], false)).toBe("Read 1 source");
    expect(stepsLabel([{ tool: "a" }, { tool: "b" }], true)).toBe("Read 2 sources");
    expect(toolWords("unknown_tool")).toBe("unknown_tool");
    expect(argLine({ month: "2026-11", cursor: "x", limit: 5 })).toBe("month: 2026-11 · limit: 5");
  });
});

describe("own API key", () => {
  test("parse what the secure store holds", () => {
    expect(parseByok(null)).toBeNull();
    expect(parseByok("garbage")).toBeNull();
    expect(parseByok(JSON.stringify({ provider: "mistral", apiKey: "x" }))).toBeNull();
    expect(parseByok(JSON.stringify({ provider: "openrouter", apiKey: "sk-or-1234567890" }))).toEqual({ provider: "openrouter", apiKey: "sk-or-1234567890", model: "", enabled: true });
  });

  test("sent only when on and plausible; masked on screen", () => {
    expect(byokInput({ provider: "anthropic", apiKey: " sk-ant-1234567890 ", model: " ", enabled: true })).toEqual({ provider: "anthropic", apiKey: "sk-ant-1234567890" });
    expect(byokInput({ provider: "anthropic", apiKey: "sk-ant-1234567890", model: "claude-x", enabled: false })).toBeUndefined();
    expect(byokInput({ provider: "anthropic", apiKey: "short", model: "", enabled: true })).toBeUndefined();
    expect(maskKey("sk-ant-api03-abcdefghijkl-wxyz")).toBe("sk-ant…wxyz");
    expect(maskKey("abc")).toBe("•••");
  });
});

describe("off and daily cap", () => {
  test("ready with today's count", () => {
    expect(availability(status, null, null, false)).toEqual({ kind: "ready", subtitle: "claude-sonnet-5-5 · 2/5 today" });
    expect(availability(undefined, null, null, false)).toEqual({ kind: "loading" });
  });

  test("off on the server unless the member has a key", () => {
    expect(availability({ ...status, hosted: null }, null, null, false).kind).toBe("off");
    expect(availability({ ...status, hosted: null }, null, { provider: "openai", apiKey: "sk-1234567890ab", model: "", enabled: true }, true)).toEqual({ kind: "ready", subtitle: "Your openai key" });
  });

  test("cap: Android may mention Joyo Pro (no link), iOS never does", () => {
    const capped = { ...status, usedToday: 5 };
    const android = availability(capped, null, null, false);
    const ios = availability(capped, null, null, true);
    expect(android.kind).toBe("cap");
    expect((android as { message: string }).message).toContain("Joyo Pro");
    expect((ios as { message: string }).message).not.toMatch(/Pro|JoyoRogo|buy|price/i);
    // The done event's usage counts too (status may be a minute old).
    expect(availability(status, { usedToday: 5, dailyCap: 5 }, null, true).kind).toBe("cap");
    expect(availability({ ...status, plan: "pro", usedToday: 30, dailyCap: 30 }, null, null, false)).toEqual({
      kind: "cap",
      message: "That's all of today's 30 questions. They come back tomorrow (WIB), or use your own API key.",
    });
  });

  test("the server's Free-cap error is neutral on iOS", () => {
    const err = { code: "FORBIDDEN", status: 403, message: "That's all of today's 5 Joyo AI questions on Free. … Joyo Pro (bought in JoyoRogo …)", data: { upgrade: true, feature: "joyoAi", reason: "cap" } };
    expect(chatErrorMessage(err, err.message, true)).not.toMatch(/Pro|JoyoRogo/);
    expect(chatErrorMessage(err, err.message, false)).toBe(err.message);
    expect(chatErrorMessage(new Error("x"), "base", true)).toBe("base");
  });
});
