package com.joyodigitama.joyoarto.capture

import android.content.Context

/**
 * The capture switch and the allow-list of apps whose notifications may be read. Stored natively so the listener
 * service can decide before touching a notification's content, even when the JS runtime is not running.
 */
object CaptureConfig {
  private const val PREFS = "joyoarto_capture_config"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_PACKAGES = "packages"

  /** Bank Jago (Jago / Jago Syariah), Gojek and the GoPay app. The JS side can replace the list. */
  val DEFAULT_PACKAGES = setOf("com.jago.digitalBanking", "com.gojek.app", "com.gojek.gopay")

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

  fun packages(context: Context): Set<String> =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_PACKAGES, null)?.toSet()
      ?: DEFAULT_PACKAGES

  fun set(context: Context, enabled: Boolean, packages: Collection<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(KEY_ENABLED, enabled)
      .putStringSet(KEY_PACKAGES, packages.map { it.trim() }.filter { it.isNotEmpty() }.toSet())
      .apply()
  }
}
