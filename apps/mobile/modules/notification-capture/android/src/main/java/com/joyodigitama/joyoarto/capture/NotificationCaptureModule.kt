package com.joyodigitama.joyoarto.capture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class NotificationCaptureModule : Module() {
  private var listening = false

  override fun definition() = ModuleDefinition {
    Name("NotificationCapture")
    Events("onCapture")

    OnCreate { liveRef = WeakReference(this@NotificationCaptureModule) }
    OnDestroy { if (liveRef.get() === this@NotificationCaptureModule) liveRef = WeakReference(null) }
    OnStartObserving { listening = true }
    OnStopObserving { listening = false }

    Function("isPermissionGranted") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openPermissionSettings") {
      val component = ComponentName(context, CaptureListenerService::class.java)
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      start(intent) || start(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    /** App info, where Android 13+ hides "Allow restricted settings" for sideloaded apps. */
    Function("openAppDetails") {
      start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    Function("getConfig") {
      mapOf("enabled" to CaptureConfig.isEnabled(context), "packages" to CaptureConfig.packages(context).sorted())
    }

    Function("setConfig") { enabled: Boolean, packages: List<String> ->
      CaptureConfig.set(context, enabled, packages)
    }

    Function("isInstalled") { packageName: String ->
      try {
        context.packageManager.getPackageInfo(packageName, 0)
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Pending items, oldest first. They stay until ackInbox. */
    Function("readInbox") { CaptureInbox.list(context).map { it.toMap() } }

    Function("ackInbox") { ids: List<String> -> CaptureInbox.remove(context, ids) }

    Function("isDebugBuild") { isDebuggable() }

    /**
     * Debug builds only: feeds a made-up notification through the same path the listener uses (as if posted by
     * packageName), and shows it as a local notification so the tester sees what was "received".
     */
    Function("simulateNotification") { packageName: String, title: String, text: String ->
      if (!isDebuggable()) return@Function false
      val now = System.currentTimeMillis()
      CaptureListenerService.accept(context, InboxItem("sim|$packageName|$now", packageName, "sim|$now", now, title, text, true))
      showTestNotification(title, text)
      true
    }
  }

  /** True when JS is listening and got the event. */
  fun emitCapture(item: InboxItem): Boolean {
    if (!listening) return false
    return try {
      sendEvent("onCapture", mapOf("id" to item.id))
      true
    } catch (e: Exception) {
      false
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext?.applicationContext) { "No React context" }

  private fun isDebuggable() = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  private fun start(intent: Intent): Boolean = try {
    val activity = appContext.currentActivity
    if (activity != null) activity.startActivity(intent)
    else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (e: Exception) {
    false
  }

  private fun showTestNotification(title: String, text: String) {
    try {
      val nm = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        nm.createNotificationChannel(NotificationChannel(TEST_CHANNEL, "Test captures", NotificationManager.IMPORTANCE_LOW))
      }
      val n = NotificationCompat.Builder(context, TEST_CHANNEL)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("[test] $title")
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .build()
      NotificationManagerCompat.from(context).notify((System.currentTimeMillis() % 100000).toInt(), n)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS not granted: the capture itself still went through.
    }
  }

  companion object {
    private const val TEST_CHANNEL = "joyoarto_test_captures"
    @Volatile private var liveRef: WeakReference<NotificationCaptureModule> = WeakReference(null)
    val live: NotificationCaptureModule? get() = liveRef.get()
  }
}
