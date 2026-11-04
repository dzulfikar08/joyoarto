import type {
  Account,
  Category,
  Dashboard,
  Me,
  QuickAddBody,
  QuickAddResult,
  StatementResult,
  Transaction,
  TransactionPatch,
} from "./types";

/** The hosted service (app host: app, REST API, MCP). The old baroka.by.dzulfikar.com only redirects. */
export const DEFAULT_SERVER = "https://app.arto.joyorogo.com";

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 = no response (offline, DNS, timeout). */
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Worth retrying later without changing anything. */
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export type Credentials = { server: string; token: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiOptions = {
  /**
   * iOS: a Free-plan limit (the server's FORBIDDEN with data.upgrade) gets a neutral message instead of the server's,
   * which says where Joyo Pro is sold. App Review 3.1.1 / 3.1.3: no pointer to buying outside the App Store.
   */
  storeSafe?: boolean;
};

/** What a store-safe client shows for a Free-plan limit. */
export const STORE_SAFE_LIMIT_MESSAGE = "This is not included in this account's plan. Nothing was changed.";

/** A file to upload, as React Native's FormData takes it. */
export type UploadFile = { uri: string; name: string; type: string };

export type ApiClient = ReturnType<typeof createApi>;

const TIMEOUT_MS = 30_000;

export function createApi(creds: Credentials, fetchImpl: FetchLike = fetch, options: ApiOptions = {}) {
  const base = creds.server.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown; form?: FormData; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(opts.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined)).toString();
    const headers: Record<string, string> = { Authorization: `Bearer ${creds.token}`, Accept: "application/json" };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
    const abort = () => controller.abort();
    opts.signal?.addEventListener("abort", abort);
    let res: Response;
    try {
      res = await fetchImpl(`${base}/api${path}${qs ? `?${qs}` : ""}`, { method, headers, body, signal: controller.signal });
    } catch {
      throw new ApiError(controller.signal.aborted ? "The server took too long to answer." : "No connection to the server.", 0);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (proxy error page)
    }
    if (!res.ok) {
      const err = (json ?? {}) as { message?: string; code?: string; data?: { upgrade?: boolean } };
      const message =
        options.storeSafe && err.data?.upgrade === true
          ? STORE_SAFE_LIMIT_MESSAGE
          : res.status === 401
          ? "The token was not accepted. Create a new one in JoyoArto on the web (Settings → API tokens)."
          : res.status === 403
            ? (err.message ?? "This token is not allowed to do that (it needs finance:write).")
            : (err.message ?? `Server error ${res.status}`);
      throw new ApiError(message, res.status, err.code);
    }
    return json as T;
  }

  return {
    server: base,
    token: creds.token,
    me: () => request<Me>("GET", "/me"),
    accounts: () => request<{ accounts: Account[] }>("GET", "/accounts").then((r) => r.accounts),
    categories: () => request<{ categories: Category[] }>("GET", "/categories").then((r) => r.categories),
    dashboard: (month?: string) => request<Dashboard>("GET", "/reports/dashboard", { query: { month } }),
    quickAdd: (body: QuickAddBody) => request<QuickAddResult>("POST", "/transactions/quick", { body }),
    updateTransaction: ({ id, ...patch }: TransactionPatch) => request<Transaction>("PATCH", `/transactions/${encodeURIComponent(id)}`, { body: patch }),
    deleteTransaction: (id: string) => request<unknown>("DELETE", `/transactions/${encodeURIComponent(id)}`),
    /**
     * POST /api/imports/statement-file: multipart with `file` (the PDF) and `commit` ("false" = preview).
     * Same JSON as POST /api/imports/statement.
     */
    uploadStatementFile: (file: UploadFile, commit: boolean) => {
      const form = new FormData();
      // React Native's FormData takes { uri, name, type } for a file part.
      form.append("file", file as unknown as Blob);
      form.append("commit", commit ? "true" : "false");
      return request<StatementResult>("POST", "/imports/statement-file", { form, timeoutMs: 120_000 });
    },
    /**
     * POST /api/capture/transcribe: multipart with `audio` (the voice note, at most about 60 s). The server passes it to
     * Whisper and drops it; neither the audio nor the text is stored. Returns the text for capture.parse.
     */
    transcribe: (file: UploadFile, signal?: AbortSignal) => {
      const form = new FormData();
      form.append("audio", file as unknown as Blob);
      return request<{ text: string }>("POST", "/capture/transcribe", { form, timeoutMs: 45_000, signal });
    },
  };
}

/**
 * POST /api/demo/token: a demo code (for store reviewers; the server's DEMO_LOGIN_CODE) to a short-lived token for the
 * demo account, whose made-up data resets every day. No token is needed to ask.
 */
export async function requestDemoToken(server: string, code: string, fetchImpl: FetchLike = fetch): Promise<{ token: string; expiresAt: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(`${server.replace(/\/+$/, "")}/api/demo/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch {
    throw new ApiError("No connection to the server.", 0);
  }
  const json = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string | null; message?: string; code?: string } | null;
  if (!res.ok || !json?.token) {
    const message =
      res.status === 401 ? "That demo code is not right." : res.status === 404 ? "Demo login is not available on this server." : (json?.message ?? `Server error ${res.status}`);
    throw new ApiError(message, res.status, json?.code);
  }
  return { token: json.token, expiresAt: json.expiresAt ?? null };
}

/** A token looks like brk_ followed by url-safe characters. */
export function looksLikeToken(s: string) {
  return /^brk_[A-Za-z0-9_-]{16,}$/.test(s.trim());
}
