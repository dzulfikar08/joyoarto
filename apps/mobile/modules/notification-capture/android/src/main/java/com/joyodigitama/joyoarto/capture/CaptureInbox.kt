package com.joyodigitama.joyoarto.capture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One notification from an allow-listed app, waiting for the JS side to parse and queue it. Stays on the device. */
data class InboxItem(
  val id: String,
  val packageName: String,
  val key: String,
  val postedAt: Long,
  val title: String,
  val text: String,
  val simulated: Boolean,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("packageName", packageName).put("key", key).put("postedAt", postedAt)
    .put("title", title).put("text", text).put("simulated", simulated)

  fun toMap(): Map<String, Any> = mapOf(
    "id" to id, "packageName" to packageName, "key" to key, "postedAt" to postedAt.toDouble(),
    "title" to title, "text" to text, "simulated" to simulated,
  )

  companion object {
    fun fromJson(o: JSONObject) = InboxItem(
      o.getString("id"), o.getString("packageName"), o.optString("key"), o.getLong("postedAt"),
      o.optString("title"), o.optString("text"), o.optBoolean("simulated"),
    )
  }
}

/**
 * A small persistent hand-off queue between the listener service and JS (SharedPreferences, capped). Items stay until
 * JS acknowledges them, so nothing is lost when the headless task cannot start or the app is killed mid-way.
 */
object CaptureInbox {
  private const val PREFS = "joyoarto_capture_inbox"
  private const val KEY = "items"
  private const val MAX_ITEMS = 300

  @Synchronized
  fun add(context: Context, item: InboxItem) {
    val items = list(context).filterNot { it.id == item.id }.toMutableList()
    items.add(item)
    write(context, items.takeLast(MAX_ITEMS))
  }

  @Synchronized
  fun list(context: Context): List<InboxItem> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { InboxItem.fromJson(arr.getJSONObject(it)) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun remove(context: Context, ids: Collection<String>) {
    val drop = ids.toSet()
    write(context, list(context).filterNot { it.id in drop })
  }

  private fun write(context: Context, items: List<InboxItem>) {
    val arr = JSONArray()
    items.forEach { arr.put(it.toJson()) }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
  }
}
