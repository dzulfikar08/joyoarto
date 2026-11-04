import { expect, test } from "bun:test";

import { ApiError, STORE_SAFE_LIMIT_MESSAGE } from "./api";
import { errorMessage, isDemoError, isSessionOnlyError, isNetworkError, SESSION_ONLY_MESSAGE, isRetryable, isUnauthorized, isUpgradeError } from "./errors";
import { procedureOfKey, shouldPersistQuery, shouldRetry } from "./query-policy";

const orpcError = (code: string, status: number, message: string, data?: unknown) => Object.assign(new Error(message), { code, status, data });

test("classifies oRPC, REST and network errors", () => {
  expect(isUnauthorized(orpcError("UNAUTHORIZED", 401, "x"))).toBe(true);
  expect(isUnauthorized(new ApiError("x", 401))).toBe(true);
  expect(isUpgradeError(orpcError("FORBIDDEN", 403, "Joyo Pro…", { upgrade: true }))).toBe(true);
  expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
  expect(isNetworkError(new ApiError("x", 0))).toBe(true);
  expect(isRetryable(orpcError("BAD_REQUEST", 400, "x"))).toBe(false);
  expect(isRetryable(orpcError("INTERNAL_SERVER_ERROR", 500, "x"))).toBe(true);
  expect(isRetryable(new ApiError("x", 429))).toBe(true);
});

test("messages", () => {
  expect(errorMessage(new TypeError("Network request failed"))).toMatch(/No connection/);
  expect(errorMessage(orpcError("UNAUTHORIZED", 401, "x"))).toMatch(/signed out/);
  expect(errorMessage(orpcError("FORBIDDEN", 403, "Buy Joyo Pro in JoyoRogo", { upgrade: true }), { storeSafe: true })).toBe(STORE_SAFE_LIMIT_MESSAGE);
  expect(errorMessage(orpcError("FORBIDDEN", 403, "Buy Joyo Pro in JoyoRogo", { upgrade: true }))).toBe("Buy Joyo Pro in JoyoRogo");
  expect(errorMessage("plain")).toBe("plain");
});

test("query policy", () => {
  expect(shouldRetry(0, new TypeError("Network request failed"))).toBe(true);
  expect(shouldRetry(2, new TypeError("Network request failed"))).toBe(false);
  expect(shouldRetry(0, orpcError("NOT_FOUND", 404, "x"))).toBe(false);
  expect(shouldRetry(0, orpcError("UNAUTHORIZED", 401, "x"))).toBe(false);
  expect(procedureOfKey([["reports", "dashboard"], { type: "query" }])).toBe("reports.dashboard");
  expect(procedureOfKey(["transactions", {}])).toBeNull();
  expect(shouldPersistQuery({ queryKey: [["reports", "dashboard"], {}], state: { status: "success" } })).toBe(true);
  expect(shouldPersistQuery({ queryKey: [["reports", "dashboard"], {}], state: { status: "error" } })).toBe(false);
  expect(shouldPersistQuery({ queryKey: [["transactions", "search"], {}], state: { status: "success" } })).toBe(false);
});

test("demo and session-only refusals", () => {
  const demo = orpcError("FORBIDDEN", 403, "The demo account cannot invite people.", { demo: true, action: "invite" });
  expect(isDemoError(demo)).toBe(true);
  expect(errorMessage(demo)).toMatch(/demo account cannot invite/);
  const web = orpcError("FORBIDDEN", 403, "Do this from the JoyoArto web app.");
  expect(isSessionOnlyError(web)).toBe(true);
  expect(isDemoError(web)).toBe(false);
  expect(errorMessage(web, { storeSafe: true })).toBe(SESSION_ONLY_MESSAGE);
  expect(SESSION_ONLY_MESSAGE).not.toMatch(/web/i);
});
