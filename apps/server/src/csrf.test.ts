import { expect, test } from "bun:test";

import { isProtectedPath, passesCsrfCheck } from "./csrf";

const API = "https://app.arto.joyorogo.com/api/household/invites/accept";
const allowed = ["https://app.arto.joyorogo.com", "https://arto.joyorogo.com"];

function req(headers: Record<string, string>, method = "POST", url = API) {
  return new Request(url, { method, headers });
}

test("cross-site form POST with the session cookie is refused", () => {
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }), allowed)).toBe(false);
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "null" }), allowed)).toBe(false);
  expect(passesCsrfCheck(req({ cookie: "s=1", "sec-fetch-site": "cross-site" }), allowed)).toBe(false);
  expect(passesCsrfCheck(req({ cookie: "s=1", "sec-fetch-site": "same-site" }), allowed)).toBe(false);
  expect(passesCsrfCheck(req({ cookie: "s=1", referer: "https://evil.example/x" }), allowed)).toBe(false);
  // No Origin, no Sec-Fetch-Site, no Referer: nothing proves it is ours.
  expect(passesCsrfCheck(req({ cookie: "s=1" }), allowed)).toBe(false);
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://evil.example" }, "DELETE"), allowed)).toBe(false);
});

test("our own origins pass", () => {
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://app.arto.joyorogo.com" }), allowed)).toBe(true);
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://arto.joyorogo.com" }), allowed)).toBe(true);
  // The request's own origin always counts (the old host answering its own pages).
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://baroka.by.dzulfikar.com" }, "POST", "https://baroka.by.dzulfikar.com/rpc/x"), allowed)).toBe(true);
  expect(passesCsrfCheck(req({ cookie: "s=1", "sec-fetch-site": "same-origin" }), allowed)).toBe(true);
  expect(passesCsrfCheck(req({ cookie: "s=1", referer: "https://app.arto.joyorogo.com/settings" }), allowed)).toBe(true);
});

test("bearer callers, cookieless callers and reads are not affected", () => {
  expect(passesCsrfCheck(req({ authorization: "Bearer brk_abc", origin: "https://evil.example" }), allowed)).toBe(true);
  expect(passesCsrfCheck(req({ authorization: "Bearer sessiontoken", "content-type": "multipart/form-data; boundary=x" }), allowed)).toBe(true);
  expect(passesCsrfCheck(req({}), allowed)).toBe(true);
  expect(passesCsrfCheck(req({ cookie: "s=1", origin: "https://evil.example" }, "GET"), allowed)).toBe(true);
});

test("only /rpc and /api/* are checked", () => {
  expect(isProtectedPath("/rpc/transactions/list")).toBe(true);
  expect(isProtectedPath("/api/rules")).toBe(true);
  expect(isProtectedPath("/share-target")).toBe(false);
  expect(isProtectedPath("/mcp")).toBe(false);
});
