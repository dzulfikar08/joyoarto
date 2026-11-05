import * as FileSystem from "expo-file-system/legacy";

import { ApiError, STORE_SAFE_LIMIT_MESSAGE, type UploadFile } from "../lib/api";
import { storeSafe } from "../lib/platform";
import type { StatementResult } from "../lib/types";

/**
 * File uploads on the phone do not use fetch + FormData. React Native's fetch cannot reliably send a { uri } file part:
 * the request dies before it leaves the phone ("No connection to the server"). That happens with content:// PDFs from
 * the share sheet and with the receipt photos the image picker leaves in the cache. So every multipart upload goes
 * through Expo's native uploader, and content:// files are copied into the app's cache first.
 */
export async function toCacheFile(file: UploadFile): Promise<UploadFile> {
  if (file.uri.startsWith("file://")) return file;
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "upload.bin";
  const dest = `${FileSystem.cacheDirectory}upload-${Date.now()}-${safe}`;
  await FileSystem.copyAsync({ from: file.uri, to: dest });
  return { ...file, uri: dest };
}

export type NativeUpload = {
  url: string;
  token: string;
  file: UploadFile;
  fieldName: string;
  parameters?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** A multipart POST with the native uploader. Returns the status and body text; throws ApiError(0) when it never got an answer. */
export async function nativeMultipart(u: NativeUpload): Promise<{ status: number; text: string }> {
  let local: UploadFile;
  try {
    local = await toCacheFile(u.file);
  } catch {
    throw new ApiError("Could not read that file on this phone. Save it to Files first, then pick it from there.", 0);
  }
  const task = FileSystem.createUploadTask(u.url, local.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: u.fieldName,
    mimeType: u.file.type || "application/octet-stream",
    parameters: u.parameters,
    headers: { Authorization: `Bearer ${u.token}`, Accept: "application/json" },
  });
  let timedOut = false;
  const cancel = () => void task.cancelAsync().catch(() => {});
  const timer = u.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        cancel();
      }, u.timeoutMs)
    : undefined;
  u.signal?.addEventListener("abort", cancel);
  try {
    const res = await task.uploadAsync();
    if (!res) throw new Error("cancelled");
    return { status: res.status, text: res.body ?? "" };
  } catch {
    if (u.signal?.aborted) throw new ApiError("Cancelled.", 0);
    throw new ApiError(timedOut ? "The server took too long to answer." : "No connection to the server.", 0);
  } finally {
    clearTimeout(timer);
    u.signal?.removeEventListener("abort", cancel);
    if (local.uri !== u.file.uri) void FileSystem.deleteAsync(local.uri, { idempotent: true }).catch(() => {});
  }
}

/** POST /api/imports/statement-file as multipart (`file`, `commit`), the same JSON as the fetch path. */
export async function uploadStatementNative(server: string, token: string, file: UploadFile, commit: boolean): Promise<StatementResult> {
  const res = await nativeMultipart({
    url: `${server.replace(/\/+$/, "")}/api/imports/statement-file`,
    token,
    file: { ...file, type: file.type || "application/pdf" },
    fieldName: "file",
    parameters: { commit: commit ? "true" : "false" },
    timeoutMs: 120_000,
  });
  let json: unknown = null;
  try {
    json = res.text ? JSON.parse(res.text) : null;
  } catch {
    // not JSON
  }
  if (res.status < 200 || res.status >= 300) {
    const err = (json ?? {}) as { message?: string; code?: string; data?: { upgrade?: boolean } };
    // iOS never shows the server's "Joyo Pro ... in JoyoRogo" limit text (App Review 3.1.1; src/lib/platform.ts).
    const message = storeSafe && err.data?.upgrade === true ? STORE_SAFE_LIMIT_MESSAGE : (err.message ?? `Server error ${res.status}`);
    throw new ApiError(message, res.status, err.code);
  }
  return json as StatementResult;
}
