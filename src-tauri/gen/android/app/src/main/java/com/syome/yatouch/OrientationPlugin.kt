package com.syome.yatouch

import android.app.Activity
import android.content.pm.ActivityInfo
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class OrientationArgs {
  var orientation: String = ""
}

@TauriPlugin
class OrientationPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun lock(invoke: Invoke) {
    val requested = when (invoke.parseArgs(OrientationArgs::class.java).orientation) {
      "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      "auto" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      else -> {
        invoke.reject("unknown orientation")
        return
      }
    }

    activity.runOnUiThread { activity.requestedOrientation = requested }
    invoke.resolve()
  }
}
