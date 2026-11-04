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
