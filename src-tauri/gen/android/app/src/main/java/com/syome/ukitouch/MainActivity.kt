package com.syome.ukitouch

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

/** Shared with the `theme` plugin command. */
internal const val THEME_PREFS = "ukitouch.theme"

class MainActivity : TauriActivity() {
  private lateinit var mWebView: WebView

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
    mWebView = webView
    webView.settings.setSupportZoom(false)
    webView.setBackgroundColor(Color.TRANSPARENT)

    // Hand the hardware back press to the page, exit when it returns false.
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          mWebView.evaluateJavascript(
            "(() => { try { return window.__ukitouch_back?.() === true } catch { return false } })()"
          ) { result ->
            if (result != "true") {
              isEnabled = false
              onBackPressed()
              isEnabled = true
            }
          }
        }
      }
    )
  }
}
