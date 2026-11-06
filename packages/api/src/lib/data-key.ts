// The Worker's data key (secret DATA_KEY), configured once per isolate by apps/server, and the seal/unseal helpers
// the services call around the columns listed in ENCRYPTED_COLUMNS. Without a key, seal* return their input and
// unseal* pass plaintext through: development, tests and self-hosts behave exactly as before. A ciphertext read
// without the key that wrote it is an error (never shown as gibberish). Docs: docs/operator-access.md.

import { DataKeyError, decryptBytes, decryptText, encryptBytes, encryptText, importDataKey, isEncrypted } from "./field-crypto";
import type { DataKey } from "./field-crypto";

type Ring = { current: DataKey | null; all: DataKey[] };

let ring: Promise<Ring> = Promise.resolve({ current: null, all: [] });
let enabled = false;

/**
 * Set the key new values are written with (null = encryption off) and older keys that can still be read (a
 * rotation). Calling it again replaces the keyring; tests use that to switch encryption on and off.
 */
export function configureDataKey(current: string | null | undefined, previous: readonly string[] = []): void {
  const cur = current?.trim() || null;
  const old = previous.map((k) => k.trim()).filter(Boolean);
  enabled = Boolean(cur);
  ring = (async () => {
    const currentKey = cur ? await importDataKey(cur) : null;
    const others = await Promise.all(old.map(importDataKey));
    return { current: currentKey, all: [...(currentKey ? [currentKey] : []), ...others] };
  })();
  // Surface a malformed secret in the logs at startup, not only on the first request.
  ring.catch((e: unknown) => console.error("[data-key]", e instanceof Error ? e.message : e));
}

/** True when DATA_KEY is set: new values are written encrypted. */
export function dataKeyEnabled(): boolean {
  return enabled;
}

/** The key id (first 8 hex of its SHA-256) new values are written with; null when encryption is off. */
export async function currentKeyId(): Promise<string | null> {
  return (await ring).current?.id ?? null;
}

export async function sealText<T extends string | null | undefined>(value: T): Promise<T> {
  if (value === null || value === undefined || value === "" || isEncrypted(value)) return value;
  const { current } = await ring;
  return (current ? await encryptText(current, value) : value) as T;
}

export async function unsealText<T extends string | null | undefined>(value: T): Promise<T> {
  if (!isEncrypted(value)) return value;
  return (await decryptText((await ring).all, value)) as T;
}

/**
 * For drizzle `mode: "json"` columns: the value becomes the ciphertext of its JSON (stored as a JSON string). Typed as
 * the input so it fits the column; only ever read back through unsealJson.
 */
export async function sealJson<T>(value: T): Promise<T> {
  if (value === null || value === undefined || isEncrypted(value)) return value;
  const { current } = await ring;
  return (current ? await encryptText(current, JSON.stringify(value)) : value) as T;
}

export async function unsealJson<T>(value: T): Promise<T> {
  if (!isEncrypted(value)) return value;
  return JSON.parse(await decryptText((await ring).all, value)) as T;
}

export async function sealBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const { current } = await ring;
  return current ? encryptBytes(current, bytes) : bytes;
}

export async function unsealBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return decryptBytes((await ring).all, bytes);
}

/** A copy of `row` with the named text fields opened. */
export async function unsealRow<R extends Record<string, unknown>, K extends keyof R>(row: R, fields: readonly K[]): Promise<R> {
  const out = { ...row };
  for (const f of fields) {
    const v = out[f];
    if (isEncrypted(v)) out[f] = (await decryptText((await ring).all, v)) as R[K];
  }
  return out;
}

export { DataKeyError, isEncrypted };
