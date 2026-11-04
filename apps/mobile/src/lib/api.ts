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

export const DEFAULT_SERVER = "https://baroka.by.dzulfikar.com";

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

/** A file to upload, as React Native's FormData takes it. */
export type UploadFile = { uri: string; name: string; type: string };

export type ApiClient = ReturnType<typeof createApi>;

const TIMEOUT_MS = 30_000;

export function createApi(creds: Credentials, fetchImpl: FetchLike = fetch) {
  const base = creds.server.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown; form?: FormData; timeoutMs?: number } = {}): Promise<T> {
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
    let res: Response;
    try {
      res = await fetchImpl(`${base}/api${path}${qs ? `?${qs}` : ""}`, { method, headers, body, signal: controller.signal });
    } catch {
      throw new ApiError(controller.signal.aborted ? "The server took too long to answer." : "No connection to the server.", 0);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (proxy error page)
    }
    if (!res.ok) {
      const err = (json ?? {}) as { message?: string; code?: string };
      const message =
        res.status === 401
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
  };
}

/** A token looks like brk_ followed by url-safe characters. */
export function looksLikeToken(s: string) {
  return /^brk_[A-Za-z0-9_-]{16,}$/.test(s.trim());
}
