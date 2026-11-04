import { describe, expect, test } from "bun:test";

import { ApiError, createApi } from "../lib/api";
import { mockStatementResult, summarize, uploadStatement } from "./statement-file";

const file = { uri: "file:///data/cache/jago-oct.pdf", name: "jago-oct.pdf", type: "application/pdf" };

describe("POST /api/imports/statement-file", () => {
  test("sends multipart with file and commit, and the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createApi({ server: "http://10.0.2.2:3500/", token: "brk_test" }, async (url, init) => {
      calls.push({ url, init: init! });
      return new Response(JSON.stringify(mockStatementResult("jago-oct.pdf", false)), { status: 200 });
    });
    const r = await uploadStatement(api, file, false, false);
    expect(r.kind).toBe("jago");
    expect(calls[0]!.url).toBe("http://10.0.2.2:3500/api/imports/statement-file");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer brk_test");
    // The runtime sets the multipart boundary itself.
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = calls[0]!.init.body as FormData;
    expect(form.get("commit")).toBe("false");
    expect(form.has("file")).toBe(true);
  });

  test("an error response becomes an ApiError with the server's message", async () => {
    const api = createApi({ server: "http://x", token: "brk_test" }, async () =>
      new Response(JSON.stringify({ code: "BAD_REQUEST", status: 400, message: "Not a statement JoyoArto can read yet" }), { status: 400 }),
    );
    const err = await uploadStatement(api, file, true, false).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Not a statement JoyoArto can read yet");
    expect(err.retryable).toBe(false);
  });

  test("offline is retryable", async () => {
    const api = createApi({ server: "http://x", token: "brk_test" }, async () => {
      throw new TypeError("Network request failed");
    });
    const err = await api.me().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
  });

  test("mock mode never calls the server", async () => {
    const r = await uploadStatement(null, { ...file, name: "gopay-oct.pdf" }, true, true);
    expect(r.kind).toBe("gopay");
    expect(r.committed).toBe(true);
  });
});

describe("summary", () => {
  test("jago", () => {
    const s = summarize(mockStatementResult("jago.pdf", false));
    expect(s).toMatchObject({ kind: "Bank Jago", newRows: 55, duplicates: 3, verified: true, period: "2026-10-01 – 2026-10-31" });
  });
  test("gopay asks for the missing Jago statement", () => {
    const s = summarize(mockStatementResult("gopay.pdf", false));
    expect(s.notes.join(" ")).toContain("not imported yet");
  });
  test("unverified balances are said first", () => {
    const r = { ...mockStatementResult("jago.pdf", false), balancesVerified: false, problems: ["Kantong Utama: running balance off by Rp 1.000 on 2026-10-03"] };
    expect(summarize(r).notes[0]).toContain("do not add up");
  });
});
