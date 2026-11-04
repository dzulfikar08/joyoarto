package com.joyodigitama.joyoarto.capture

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Starts the "JoyoArtoCapture" JS task (src/capture/headless.ts), which drains CaptureInbox. */
class CaptureHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 60_000, true)

  companion object {
    const val TASK = "JoyoArtoCapture"
  }
}
