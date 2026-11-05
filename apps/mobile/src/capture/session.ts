// Captures belong to the account that was signed in when they were read. Imported for its side effects by the root
// layout and the headless task, so it runs wherever a sign-in or sign-out can happen.

import { NotificationCapture } from "@/modules/notification-capture";

import { onSessionChange, type Me, type SignOutInfo } from "../lib/auth";
import { loadSettings, resetAccountSettings, syncNativeConfig } from "../lib/settings";
import { resumeAfterSignIn } from "./queue";
import { capturesOwner, clearCaptures, mutateCaptures, setCapturesOwner } from "./store";
import { syncCaptures } from "./sync";

/** Everything capture keeps for an account: the queue (raw notification text), the native inbox, its settings. */
async function forgetCaptures() {
  NotificationCapture.setConfig(false, []);
  NotificationCapture.ackInbox(NotificationCapture.readInbox().map((i) => i.id));
  await clearCaptures();
  await resetAccountSettings();
}

async function afterSignOut(info: SignOutInfo) {
  // Signed out, the listener reads nothing (syncNativeConfig checks the session).
  await syncNativeConfig(await loadSettings());
  // A refused credential (expired, revoked) keeps the queue for the same account; signing out on purpose deletes it.
  if (info.expired) {
    if (info.userId && !(await capturesOwner())) await setCapturesOwner(info.userId);
    return;
  }
  await forgetCaptures();
}

async function afterSignIn(me: Me) {
  const owner = await capturesOwner();
  if (owner && owner !== me.user.id) await forgetCaptures();
  else await mutateCaptures(resumeAfterSignIn);
  await setCapturesOwner(me.user.id);
  await syncNativeConfig(await loadSettings());
  await syncCaptures();
}

let bound = false;

export function bindCaptureSession() {
  if (bound) return;
  bound = true;
  onSessionChange({
    signIn: (me) => void afterSignIn(me).catch(() => undefined),
    signOut: (info) => void afterSignOut(info).catch(() => undefined),
  });
}

bindCaptureSession();
