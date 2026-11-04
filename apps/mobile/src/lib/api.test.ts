import { describe, expect, test } from "bun:test";

import { ApiError, createApi, requestDemoToken, STORE_SAFE_LIMIT_MESSAGE } from "./api";

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

// The server's Free-plan limit: FORBIDDEN with data.upgrade, and a message that says where Joyo Pro is sold.
const limit = () =>
  new Response(
    JSON.stringify({
      defined: false,
      code: "FORBIDDEN",
      status: 403,
      message: "Statement imports: 2 a month on Free. Joyo Pro (bought in JoyoRogo with the same Google account) unlocks it; see Settings → Billing.",
      data: { upgrade: true, feature: "statementImports" },
    }),
    { status: 403 },
  );

describe("Free-plan limits", () => {
  test("store-safe (iOS): neutral message, no pointer to buying elsewhere", async () => {
    const api = createApi({ server: "http://x", token: "brk_test" }, async () => limit(), { storeSafe: true });
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe(STORE_SAFE_LIMIT_MESSAGE);
    expect(err.message).not.toMatch(/JoyoRogo|Joyo Pro|Billing|buy/i);
  });

  test("Android keeps the server's message", async () => {
    const api = createApi({ server: "http://x", token: "brk_test" }, async () => limit());
    const err = await api.me().catch((e) => e);
    expect(err.message).toContain("Joyo Pro");
  });

  test("store-safe leaves other 403s alone", async () => {
    const api = createApi({ server: "http://x", token: "brk_test" }, async () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "Missing scope finance:write" }), { status: 403 }), {
      storeSafe: true,
    });
    const err = await api.me().catch((e) => e);
    expect(err.message).toBe("Missing scope finance:write");
  });
});

describe("POST /api/capture/transcribe", () => {
  test("sends the voice note as multipart `audio` with the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createApi({ server: "https://app.example", token: "brk_x" }, async (url, init) => {
      calls.push({ url, init: init! });
      return new Response(JSON.stringify({ text: "kopi 25rb gopay" }), { status: 200 });
    });
    const out = await api.transcribe({ uri: "file:///rec.m4a", name: "voice.m4a", type: "audio/mp4" });
    expect(out).toEqual({ text: "kopi 25rb gopay" });
    expect(calls[0]!.url).toBe("https://app.example/api/capture/transcribe");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer brk_x");
  });

  test("the daily voice cap comes back as the server's message", async () => {
    const api = createApi({ server: "https://x", token: "brk_x" }, async () =>
      new Response(JSON.stringify({ code: "TOO_MANY_REQUESTS", message: "That's all the voice notes for today. Type it instead." }), { status: 429 }),
    );
    await expect(api.transcribe({ uri: "file:///a.m4a", name: "voice.m4a", type: "audio/mp4" })).rejects.toThrow("voice notes for today");
  });
});
