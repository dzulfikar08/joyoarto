import { describe, expect, test } from "bun:test";

import { ApiError, createApi, STORE_SAFE_LIMIT_MESSAGE } from "./api";

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
