// Field-level encryption for member data at rest (docs/operator-access.md). AES-256-GCM with WebCrypto, a random
// 12-byte IV per value, and a versioned prefix so plaintext and ciphertext rows can sit side by side while old rows
// are backfilled:
//
//   text:  enc:v1:<kid>:<base64url(iv ‖ ciphertext+tag)>
//   bytes: "enc:v1:<kid>:" ‖ iv ‖ ciphertext+tag            (R2 objects; JPEG/PNG never start with "enc:")
//
// <kid> is the first 8 hex digits of SHA-256(key): it names the key without revealing it, so a value written under an
// older key can still be read after a rotation (pass the old key too) and a wrong key fails with a clear error.
// Pure: no Worker bindings, no module state (the configured key lives in lib/data-key.ts).

export const ENC_PREFIX = "enc:v1:";

export type DataKey = { id: string; key: CryptoKey };

/** Raised for a value this keyring cannot open: unknown key id, wrong key, or tampered ciphertext. */
export class DataKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataKeyError";
  }
}

/** WebCrypto takes ArrayBuffer-backed views; every array here is one (never a SharedArrayBuffer). */
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

function fromBase64(b64: string): Uint8Array {
  const s = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A 32-byte key given as base64 (standard or url-safe), e.g. `openssl rand -base64 32`. */
export async function importDataKey(base64: string): Promise<DataKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(base64);
  } catch {
    throw new DataKeyError("DATA_KEY is not valid base64.");
  }
  if (raw.length !== 32) throw new DataKeyError(`DATA_KEY must be 32 bytes (got ${raw.length}).`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf(raw)));
  const id = [...digest.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", buf(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { id, key };
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

async function seal(key: DataKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key.key, buf(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(keys: readonly DataKey[], kid: string, sealed: Uint8Array): Promise<Uint8Array> {
  const key = keys.find((k) => k.id === kid);
  if (!key) throw new DataKeyError(`Encrypted with key ${kid}, which is not configured (DATA_KEY).`);
  if (sealed.length < 12 + 16) throw new DataKeyError("Encrypted value is truncated.");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(sealed.subarray(0, 12)) }, key.key, buf(sealed.subarray(12))));
  } catch {
    throw new DataKeyError(`Could not decrypt a value with key ${kid}: wrong key or altered data.`);
  }
}

export async function encryptText(key: DataKey, plaintext: string): Promise<string> {
  return `${ENC_PREFIX}${key.id}:${toBase64Url(await seal(key, enc.encode(plaintext)))}`;
}

/** Plaintext (no prefix) passes through unchanged, so rows written before encryption keep working. */
export async function decryptText(keys: readonly DataKey[], value: string): Promise<string> {
  if (!isEncrypted(value)) return value;
  const rest = value.slice(ENC_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 1) throw new DataKeyError("Encrypted value has no key id.");
  let sealed: Uint8Array;
  try {
    sealed = fromBase64(rest.slice(colon + 1));
  } catch {
    throw new DataKeyError("Encrypted value is not valid base64.");
  }
  return dec.decode(await open(keys, rest.slice(0, colon), sealed));
}

const BYTES_PREFIX = enc.encode(ENC_PREFIX);

export function isEncryptedBytes(bytes: Uint8Array): boolean {
  if (bytes.length < BYTES_PREFIX.length) return false;
  for (let i = 0; i < BYTES_PREFIX.length; i++) if (bytes[i] !== BYTES_PREFIX[i]) return false;
  return true;
}

export async function encryptBytes(key: DataKey, plain: Uint8Array): Promise<Uint8Array> {
  const head = enc.encode(`${ENC_PREFIX}${key.id}:`);
  const sealed = await seal(key, plain);
  const out = new Uint8Array(head.length + sealed.length);
  out.set(head);
  out.set(sealed, head.length);
  return out;
}

/** Bytes without the prefix (a photo stored before encryption) pass through unchanged. */
export async function decryptBytes(keys: readonly DataKey[], bytes: Uint8Array): Promise<Uint8Array> {
  if (!isEncryptedBytes(bytes)) return bytes;
  const start = BYTES_PREFIX.length;
  const colon = bytes.indexOf(0x3a, start);
  if (colon < 0 || colon - start > 16) throw new DataKeyError("Encrypted file has no key id.");
  return open(keys, dec.decode(bytes.subarray(start, colon)), bytes.subarray(colon + 1));
}
