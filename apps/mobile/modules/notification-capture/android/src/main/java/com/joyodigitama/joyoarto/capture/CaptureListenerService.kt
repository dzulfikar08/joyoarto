package com.joyodigitama.joyoarto.capture

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * Receives every posted notification from the system, but reads nothing unless capture is switched on and the
 * notification comes from an allow-listed package. Only title and text of those are kept, on the device, for the JS
 * parser; other apps' notifications are dropped before their extras are touched.
 */
class CaptureListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    sbn ?: return
    val context = applicationContext
    if (!CaptureConfig.isEnabled(context)) return
    if (sbn.packageName !in CaptureConfig.packages(context)) return
    val n = sbn.notification ?: return
    // Group summaries repeat their children; ongoing ones are progress/music/etc., never a finished payment.
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return

    val extras = n.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val text = (big?.takeIf { it.isNotBlank() } ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()).orEmpty()
    if (title.isBlank() && text.isBlank()) return

    accept(context, InboxItem(
      id = "${sbn.key}|${sbn.postTime}",
      packageName = sbn.packageName,
      key = sbn.key,
      postedAt = sbn.postTime,
      title = title.take(300),
      text = text.take(1500),
      simulated = false,
    ))
  }

  companion object {
    private const val TAG = "JoyoArtoCapture"

    /** Hands an accepted notification to JS: persisted first, then the live event or the headless task. */
    fun accept(context: Context, item: InboxItem) {
      CaptureInbox.add(context, item)
      val module = NotificationCaptureModule.live
      if (module != null && module.emitCapture(item)) return
      try {
        val intent = Intent(context, CaptureHeadlessService::class.java)
        context.startService(intent)
        HeadlessJsTaskService.acquireWakeLockNow(context)
      } catch (e: Exception) {
        // Background start refused (rare for a bound listener): the inbox is drained when the app next opens.
        Log.w(TAG, "could not start the capture task; it stays in the inbox", e)
      }
    }
  }
}
