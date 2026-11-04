import { NotificationCapture } from "@/modules/notification-capture";

import { ApiError } from "../lib/api";
import { getApi } from "../lib/auth";
import { getSettings, loadSettings } from "../lib/settings";
import { applyOutcome, due, ingest, quickAddBody, type CaptureItem, type SendOutcome } from "./queue";
import { getCaptures, mutateCaptures, updateCapture } from "./store";

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

/** Sends what is due. One run at a time; callers during a run share it. */
export function syncCaptures(opts: { force?: string[] } = {}): Promise<void> {
  running ??= (async () => {
    try {
      await drainInbox();
      const api = await getApi();
      if (!api) return;
      const now = Date.now();
      const forced = new Set(opts.force ?? []);
      const items = getCaptures();
      const batch = [...due(items, now), ...items.filter((i) => forced.has(i.id) && i.status !== "sent")];
      for (const item of batch) {
        const body = quickAddBody(item);
        if (!body) {
          await updateCapture(item.id, (i) => applyOutcome(i, { ok: false, message: "No amount to send: enter one.", retryable: false }, now));
          continue;
        }
        await updateCapture(item.id, (i) => ({ ...i, status: "sending" }));
        let outcome: SendOutcome;
        try {
          const res = await api.quickAdd(body);
          outcome = { ok: true, transactionId: res.transaction.id, display: res.transaction.display, account: res.transaction.account, category: res.transaction.category };
        } catch (error) {
          const e = error instanceof ApiError ? error : new ApiError(String(error), 0);
          outcome = { ok: false, message: e.message, retryable: e.retryable };
          // Offline or signed out: stop here, the rest would fail the same way.
          if (e.status === 0 || e.status === 401) {
            await updateCapture(item.id, (i) => applyOutcome(i, outcome, Date.now()));
            break;
          }
        }
        await updateCapture(item.id, (i) => applyOutcome(i, outcome, Date.now()));
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** User actions on one capture. */
export async function sendNow(id: string) {
  await updateCapture(id, (i) => ({ ...i, status: i.status === "sent" ? i.status : "queued", retryAt: undefined, ignoredReason: undefined }));
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
