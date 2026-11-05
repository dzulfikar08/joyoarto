import { NotificationCapture } from "@/modules/notification-capture";

import { ApiError } from "../lib/api";
import { getApi, loadSession, sessions, signOut } from "../lib/auth";
import { getSettings, loadSettings } from "../lib/settings";
import { applyOutcome, due, ingest, pauseForSignIn, quickAddBody, sendable, type CaptureItem, type SendOutcome } from "./queue";
import { capturesOwner, getCaptures, mutateCaptures, setCapturesOwner, updateCapture } from "./store";

/** Moves everything the native listener left in its inbox into the queue, then acknowledges it. */
export async function drainInbox() {
  const inbox = NotificationCapture.readInbox();
  if (!inbox.length) return 0;
  const settings = await loadSettings();
  await mutateCaptures((items) => ingest(items, inbox, settings));
  NotificationCapture.ackInbox(inbox.map((i) => i.id));
  return inbox.length;
}

let running: Promise<void> | null = null;
let again = false;
const forceNext = new Set<string>();

/**
 * Sends what is due. One run at a time: a call during a run (a new notification, Send now) asks for one more run
 * after it, with its forced ids, and its promise settles when that run is done.
 */
export function syncCaptures(opts: { force?: string[] } = {}): Promise<void> {
  for (const id of opts.force ?? []) forceNext.add(id);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const force = new Set(forceNext);
        forceNext.clear();
        await runOnce(force);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce(forced: Set<string>) {
  await drainInbox();
  const session = await loadSession();
  const api = await getApi();
  if (!session || !api) return;
  // A queue from before owners were kept belongs to whoever is signed in now.
  if (session.me && !(await capturesOwner())) await setCapturesOwner(session.me.user.id);
  const now = Date.now();
  const items = getCaptures();
  const dueNow = due(items, now);
  const batch = [...dueNow, ...items.filter((i) => forced.has(i.id) && !dueNow.includes(i))];
  for (const { id } of batch) {
    // Re-read: the user may have ignored, edited or sent it since the batch was picked.
    let claimed: CaptureItem | null = null;
    await updateCapture(id, (i) => {
      if (!sendable(i, now, forced.has(id))) return i;
      claimed = { ...i, status: "sending" };
      return claimed;
    });
    const item = claimed as CaptureItem | null;
    if (!item) continue;
    const body = quickAddBody(item);
    if (!body) {
      await updateCapture(id, (i) => applyOutcome(i, { ok: false, message: "No amount to send: enter one.", retryable: false }, now));
      continue;
    }
    let outcome: SendOutcome;
    try {
      const res = await api.quickAdd(body);
      outcome = { ok: true, transactionId: res.transaction.id, display: res.transaction.display, account: res.transaction.account, category: res.transaction.category };
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError(String(error), 0);
      if (e.status === 401) {
        // The credential no longer works: keep this and the rest queued for the same account, and sign out like the
        // oRPC client does (src/lib/query.ts). Nothing more is sent until someone signs in.
        await updateCapture(id, pauseForSignIn);
        await mutateCaptures((all) => all.map((i) => (i.status === "queued" ? pauseForSignIn(i) : i)));
        if (sessions.get()) await signOut({ expired: true });
        return;
      }
      outcome = { ok: false, message: e.message, retryable: e.retryable };
      // Offline: stop here, the rest would fail the same way.
      if (e.status === 0) {
        await updateCapture(id, (i) => applyOutcome(i, outcome, Date.now()));
        return;
      }
    }
    await updateCapture(id, (i) => applyOutcome(i, outcome, Date.now()));
  }
}

/** User actions on one capture. */
export async function sendNow(id: string) {
  await updateCapture(id, (i) => ({ ...i, status: i.status === "sent" ? i.status : "queued", retryAt: undefined, ignoredReason: undefined, pausedForSignIn: undefined }));
  await syncCaptures({ force: [id] });
}

export function ignoreCapture(id: string) {
  return updateCapture(id, (i) => ({ ...i, status: "ignored", ignoredReason: "ignored by you", retryAt: undefined }));
}

export function editCapture(id: string, edits: CaptureItem["edits"]) {
  return updateCapture(id, (i) => ({ ...i, edits: { ...i.edits, ...edits } }));
}

/** After sending: push the account/category/merchant fix to the saved (pending) transaction. */
export async function fixSentCapture(id: string, edits: CaptureItem["edits"]) {
  const item = getCaptures().find((i) => i.id === id);
  const api = await getApi();
  if (!item?.transactionId || !api) throw new Error("Not sent yet");
  const tx = await api.updateTransaction({
    id: item.transactionId,
    ...(edits.accountId && edits.accountId !== item.edits.accountId ? { accountId: edits.accountId } : {}),
    ...(edits.category !== undefined ? { category: edits.category || null } : {}),
    ...(edits.merchant !== undefined ? { merchant: edits.merchant || null } : {}),
    ...(edits.note !== undefined ? { note: edits.note || null } : {}),
  });
  await updateCapture(id, (i) => ({ ...i, edits: { ...i.edits, ...edits }, sentAccount: tx.account, sentCategory: tx.category, sentDisplay: tx.display }));
}

export { getSettings };
