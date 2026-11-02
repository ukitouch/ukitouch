package com.syome.ukitouch

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class FullscreenArgs {
  var enabled: Boolean = false
}

@TauriPlugin
class OrientationPlugin(private val activity: Activity) : Plugin(activity) {
  /** Landscape + immersive. */
  @Command
  fun fullscreen(invoke: Invoke) {
    val enabled = invoke.parseArgs(FullscreenArgs::class.java).enabled

    activity.runOnUiThread {
      activity.requestedOrientation =
        if (enabled) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

      val controller =
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      if (enabled) {
        controller.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
    }
    invoke.resolve()
  }
}
