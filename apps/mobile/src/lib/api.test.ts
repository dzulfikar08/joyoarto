import { describe, expect, test } from "bun:test";

import { ApiError, requestDemoToken } from "./api";

describe("POST /api/demo/token", () => {
  test("sends the code without a token and returns the demo token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const out = await requestDemoToken("https://app.example/", " review ", async (url, init) => {
      calls.push({ url, init: init! });
      return new Response(JSON.stringify({ token: "brk_demo", expiresAt: "2026-11-11T00:00:00.000Z" }), { status: 200 });
    });
    expect(out).toEqual({ token: "brk_demo", expiresAt: "2026-11-11T00:00:00.000Z" });
    expect(calls[0]!.url).toBe("https://app.example/api/demo/token");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: "review" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test("wrong code, demo off, offline", async () => {
    const answer = (status: number) => async () => new Response(JSON.stringify({ code: "X", message: "server says" }), { status });
    await expect(requestDemoToken("https://x", "a", answer(401))).rejects.toThrow("not right");
    await expect(requestDemoToken("https://x", "a", answer(404))).rejects.toThrow("not available");
    const offline = await requestDemoToken("https://x", "a", async () => {
      throw new TypeError("network");
    }).catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(ApiError);
    expect((offline as ApiError).status).toBe(0);
  });
});
