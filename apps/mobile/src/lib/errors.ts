// One place that turns any failure (oRPC errors, the REST client's ApiError, a dropped connection) into what the
// screens show and decide on. Duck-typed on purpose: ORPCError is rebuilt from JSON and `instanceof` is unreliable
// across bundles (the same reason oRPC ships Symbol.hasInstance). Pure, unit-tested.

import { STORE_SAFE_LIMIT_MESSAGE } from "./api";

type ErrorLike = { code?: unknown; status?: unknown; message?: unknown; data?: unknown; name?: unknown };

function asErr(e: unknown): ErrorLike {
  return typeof e === "object" && e !== null ? (e as ErrorLike) : {};
}

function status(e: unknown): number | undefined {
  const s = asErr(e).status;
  return typeof s === "number" ? s : undefined;
}

/** The credential is gone or revoked: sign in again. */
export function isUnauthorized(e: unknown): boolean {
  const err = asErr(e);
  return err.code === "UNAUTHORIZED" || status(e) === 401;
}

/** A Free-plan limit (the server's FORBIDDEN with data.upgrade). */
export function isUpgradeError(e: unknown): boolean {
  const err = asErr(e);
  const data = err.data as { upgrade?: unknown } | undefined;
  return err.code === "FORBIDDEN" && data?.upgrade === true;
}

/** Something the store reviewers' demo account may not do (the server's FORBIDDEN with data.demo). */
export function isDemoError(e: unknown): boolean {
  const err = asErr(e);
  const data = err.data as { demo?: unknown } | undefined;
  return err.code === "FORBIDDEN" && data?.demo === true;
}

/** A statement PDF JoyoArto cannot read yet (the server's BAD_REQUEST with data.reason "unsupported"): offer a format request. */
export function isUnsupportedStatement(e: unknown): boolean {
  const data = asErr(e).data as { reason?: unknown } | undefined;
  return data?.reason === "unsupported";
}

/** A procedure that needs a signed-in session (Google or Apple), not an access token (sessionProcedure). */
export function isSessionOnlyError(e: unknown): boolean {
  const err = asErr(e);
  return err.code === "FORBIDDEN" && typeof err.message === "string" && /from the JoyoArto web app/i.test(err.message);
}

/** What a token or demo sign-in sees for tokens, invites, exports and account deletion. Never points to the web app. */
export const SESSION_ONLY_MESSAGE = "Only available when you sign in with Google or Apple. Sign out from More, then sign in again.";

/** No answer at all: offline, DNS, timeout (RN's fetch throws TypeError "Network request failed"). */
export function isNetworkError(e: unknown): boolean {
  const err = asErr(e);
  if (status(e) === 0) return true;
  const message = typeof err.message === "string" ? err.message : "";
  return err.name === "TypeError" && /network|fetch|load failed/i.test(message);
}

/** Worth retrying without changing anything: no answer, rate limit, server error. A 4xx answer will not change. */
export function isRetryable(e: unknown): boolean {
  if (isNetworkError(e)) return true;
  const s = status(e);
  if (s === undefined) return true;
  return s === 408 || s === 429 || s >= 500;
}

/** What to show for an error. `storeSafe` (iOS) never names where Joyo Pro is sold. */
export function errorMessage(e: unknown, opts: { storeSafe?: boolean } = {}): string {
  if (isNetworkError(e)) return "No connection to the server. Check your internet and try again.";
  if (isUnauthorized(e)) return "You were signed out. Sign in again.";
  if (opts.storeSafe && isUpgradeError(e)) return STORE_SAFE_LIMIT_MESSAGE;
  if (isSessionOnlyError(e)) return SESSION_ONLY_MESSAGE;
  const err = asErr(e);
  if (typeof err.message === "string" && err.message) return err.message;
  return String(e);
}
