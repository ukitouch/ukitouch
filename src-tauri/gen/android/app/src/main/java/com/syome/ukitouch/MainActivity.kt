package com.syome.ukitouch

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

/** Shared with the `theme` plugin command. */
internal const val THEME_PREFS = "ukitouch.theme"

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()

    // Paint the window in the app theme to prevent flashing on launching.
    val prefs = getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
    val systemDark =
      resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
        Configuration.UI_MODE_NIGHT_YES
    val dark = prefs.getBoolean("dark", systemDark)
    window.setBackgroundDrawable(
      ColorDrawable(if (dark) Color.BLACK else 0xFFF9FAFB.toInt())
    )

    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.settings.setSupportZoom(false)
    webView.setBackgroundColor(Color.TRANSPARENT)
  }
}
