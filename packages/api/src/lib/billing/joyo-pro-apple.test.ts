import { describe, expect, test } from "bun:test";

import { JoyoProAppleRefused, JoyoProUnauthorized, JoyoProUnavailable, fetchAppleAccountToken, redeemAppleTransaction } from "./joyo-pro";

const config = { apiUrl: "https://rogo.test", key: "k".repeat(64) };
const who = { googleSub: "g-1", email: "a@x.id", name: "Ani" };

function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("App Store via JoyoRogo", () => {
  test("token: posts who the buyer is with the internal key", async () => {
    const f = fake(200, { appAccountToken: "6f1c2a52-8c1e-4d1e-9b39-1a2b3c4d5e6f" });
    expect(await fetchAppleAccountToken(config, who, f.impl)).toBe("6f1c2a52-8c1e-4d1e-9b39-1a2b3c4d5e6f");
    expect(f.calls[0]!.url).toBe("https://rogo.test/api/internal/joyo-pro/apple");
    expect((f.calls[0]!.init.headers as Record<string, string>)["x-joyo-internal-key"]).toBe(config.key);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ googleSub: "g-1", email: "a@x.id", name: "Ani" });
  });

  test("redeem: returns the new Joyo Pro status", async () => {
    const f = fake(200, { status: "granted", sandbox: false, joyo: { pro: true, until: "2027-01-01T00:00:00.000Z", plan: "monthly", source: "apple" } });
    const r = await redeemAppleTransaction(config, { googleSub: null, email: "a@x.id" }, "jws", f.impl);
    expect(r.status).toBe("granted");
    expect(r.joyo).toEqual({ pro: true, until: new Date("2027-01-01T00:00:00.000Z"), plan: "monthly", source: "apple" });
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ email: "a@x.id", signedTransaction: "jws" });
  });

  test("a refusal becomes a readable error; a bad key and an outage do not blame the buyer", async () => {
    const refused = redeemAppleTransaction(config, who, "jws", fake(403, { error: "other-account" }).impl);
    await expect(refused).rejects.toBeInstanceOf(JoyoProAppleRefused);
    await expect(redeemAppleTransaction(config, who, "jws", fake(403, { error: "other-account" }).impl)).rejects.toThrow(/another Joyo account/);
    await expect(redeemAppleTransaction(config, who, "jws", fake(401, { error: "unauthorized" }).impl)).rejects.toBeInstanceOf(JoyoProUnauthorized);
    await expect(redeemAppleTransaction(config, who, "jws", fake(502, {}).impl)).rejects.toBeInstanceOf(JoyoProUnavailable);
    await expect(redeemAppleTransaction(config, who, "jws", fake(404, { error: "not_found" }).impl)).rejects.toBeInstanceOf(JoyoProUnavailable);
  });
});
