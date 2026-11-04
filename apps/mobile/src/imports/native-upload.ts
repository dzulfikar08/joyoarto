import * as FileSystem from "expo-file-system/legacy";

import { ApiError, STORE_SAFE_LIMIT_MESSAGE, type UploadFile } from "../lib/api";
import { storeSafe } from "../lib/platform";
import type { StatementResult } from "../lib/types";

/**
 * Android hands shared and picked PDFs over as content:// URIs, which React Native's fetch + FormData often cannot
 * read: the request then dies before it leaves the phone ("No connection to the server"). Copy the file into the
 * app's own cache first, then upload it with Expo's native multipart uploader.
 */
export async function toCacheFile(file: UploadFile): Promise<UploadFile> {
  if (file.uri.startsWith("file://")) return file;
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "statement.pdf";
  const dest = `${FileSystem.cacheDirectory}upload-${Date.now()}-${safe}`;
  await FileSystem.copyAsync({ from: file.uri, to: dest });
  return { ...file, uri: dest };
}

/** POST /api/imports/statement-file as multipart (`file`, `commit`), the same JSON as the fetch path. */
export async function uploadStatementNative(server: string, token: string, file: UploadFile, commit: boolean): Promise<StatementResult> {
  let local: UploadFile;
  try {
    local = await toCacheFile(file);
  } catch {
    throw new ApiError("Could not read that PDF on this phone. Save it to Files first, then pick it from there.", 0);
  }
  let res: FileSystem.FileSystemUploadResult;
  try {
    res = await FileSystem.uploadAsync(`${server.replace(/\/+$/, "")}/api/imports/statement-file`, local.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: file.type || "application/pdf",
      parameters: { commit: commit ? "true" : "false" },
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new ApiError("No connection to the server.", 0);
  } finally {
    if (local.uri !== file.uri) void FileSystem.deleteAsync(local.uri, { idempotent: true }).catch(() => {});
  }
  let json: unknown = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
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
