package com.cengiz718.eymentvradyopro

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("eymen_tv_prefs", MODE_PRIVATE) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN
        web = WebView(this).apply {
            setBackgroundColor(Color.rgb(8,11,17))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
        }
        setContentView(web)
        loadWeb()
    }
    private fun loadWeb() {
        val url = prefs.getString("remote_url", getString(R.string.default_server_url)) ?: getString(R.string.default_server_url)
        if (prefs.getBoolean("remote_mode", true)) web.loadUrl(url) else web.loadUrl("file:///android_asset/www/index.html")
    }
    private fun showSources() {
        val choices = arrayOf("Canlı TV - Yerel oynatıcı (M3U/M3U8)", "Uzak sunucu / web uygulaması", "APK içindeki web arayüzü")
        AlertDialog.Builder(this).setTitle("Yayın kaynağı").setItems(choices) { _, which ->
            when (which) {
                0 -> startActivity(Intent(this, NativeIptvActivity::class.java))
                1 -> { prefs.edit().putBoolean("remote_mode", true).apply(); loadWeb() }
                2 -> { prefs.edit().putBoolean("remote_mode", false).apply(); loadWeb() }
            }
        }.setNegativeButton("Kapat", null).show()
    }
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO) { showSources(); return true }
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true }
        return super.onKeyDown(keyCode, event)
    }
}