import { describe, expect, test } from "bun:test";

import { DataKeyError, ENC_PREFIX, decryptBytes, decryptText, encryptBytes, encryptText, importDataKey, isEncrypted, isEncryptedBytes } from "./field-crypto";

/** Throwaway test keys (32 bytes each), never used anywhere else. */
const KEY_A = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const KEY_B = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)));

describe("text", () => {
  test("round trip, with a versioned prefix and the key id", async () => {
    const a = await importDataKey(KEY_A);
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    const sealed = await encryptText(a, "Bayar arisan RT, titip Bu Sri 🙏");
    expect(sealed.startsWith(`${ENC_PREFIX}${a.id}:`)).toBe(true);
    expect(sealed).not.toContain("arisan");
    expect(isEncrypted(sealed)).toBe(true);
    expect(await decryptText([a], sealed)).toBe("Bayar arisan RT, titip Bu Sri 🙏");
  });

  test("a random IV: the same text never seals the same way twice", async () => {
    const a = await importDataKey(KEY_A);
    expect(await encryptText(a, "same")).not.toBe(await encryptText(a, "same"));
  });

  test("plaintext passes through unchanged", async () => {
    const a = await importDataKey(KEY_A);
    expect(await decryptText([a], "kopi pagi")).toBe("kopi pagi");
    expect(await decryptText([], "")).toBe("");
    expect(isEncrypted("enc:v2:x")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  test("the wrong key, a missing key, or altered data fail", async () => {
    const [a, b] = await Promise.all([importDataKey(KEY_A), importDataKey(KEY_B)]);
    const sealed = await encryptText(a, "rahasia");
    await expect(decryptText([b], sealed)).rejects.toThrow(DataKeyError);
    await expect(decryptText([], sealed)).rejects.toThrow(/not configured/);
    // Same key id, different key material: the tag check fails.
    await expect(decryptText([{ ...b, id: a.id }], sealed)).rejects.toThrow(/wrong key or altered/);
    const flipped = sealed.slice(0, -2) + (sealed.at(-2) === "A" ? "B" : "A") + sealed.at(-1);
    await expect(decryptText([a], flipped)).rejects.toThrow(DataKeyError);
    await expect(decryptText([a], `${ENC_PREFIX}${a.id}:AAAA`)).rejects.toThrow(/truncated/);
  });

  test("an older key can still read after a rotation", async () => {
    const [a, b] = await Promise.all([importDataKey(KEY_A), importDataKey(KEY_B)]);
    const old = await encryptText(a, "lama");
    expect(await decryptText([b, a], old)).toBe("lama");
  });

  test("keys must be 32 bytes of base64", async () => {
    await expect(importDataKey(btoa("short"))).rejects.toThrow(/32 bytes/);
    await expect(importDataKey("not base64 !!")).rejects.toThrow(DataKeyError);
    // URL-safe base64 without padding is accepted too.
    const urlSafe = KEY_B.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect((await importDataKey(urlSafe)).id).toBe((await importDataKey(KEY_B)).id);
  });
});

describe("bytes", () => {
  test("round trip; plain bytes (a JPEG) pass through", async () => {
    const [a, b] = await Promise.all([importDataKey(KEY_A), importDataKey(KEY_B)]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const sealed = await encryptBytes(a, jpeg);
    expect(isEncryptedBytes(sealed)).toBe(true);
    expect(isEncryptedBytes(jpeg)).toBe(false);
    expect([...(await decryptBytes([a], sealed))]).toEqual([...jpeg]);
    expect(await decryptBytes([a], jpeg)).toBe(jpeg);
    await expect(decryptBytes([b], sealed)).rejects.toThrow(DataKeyError);
  });
});
