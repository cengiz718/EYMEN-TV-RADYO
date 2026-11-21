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
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("eymen_tv_prefs", MODE_PRIVATE) }
    private var web: WebView? = null
    private val bg = Color.rgb(8, 11, 18)
    private val accent = Color.rgb(255, 177, 72)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showHome()
    }

    private fun makeButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 17f
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            minHeight = dp(58)
            setOnClickListener { action() }
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(35, 43, 57))
            setPadding(dp(18), dp(8), dp(18), dp(8))
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun showHome() {
        web = null
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(22), dp(32), dp(22))
            setBackgroundColor(bg)
        }
        val title = TextView(this).apply {
            text = "EYMEN TV RADYO PRO"
            textSize = 30f
            setTextColor(accent)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(8))
        }
        val subtitle = TextView(this).apply {
            text = "Mi Box ve Android TV için kumanda uyumlu ana menü"
            textSize = 15f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(22))
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        buttons.addView(makeButton("▶   CANLI TV / KANALLAR") {
            startActivity(Intent(this, NativeIptvActivity::class.java))
        }, LinearLayout.LayoutParams(dp(420), dp(64)).apply { bottomMargin = dp(12) })
        buttons.addView(makeButton("⚙   YAYIN LİSTESİ VE AYARLAR") { showSettings() },
            LinearLayout.LayoutParams(dp(420), dp(64)).apply { bottomMargin = dp(12) })
        buttons.addView(makeButton("▣   WEB UYGULAMASINI AÇ") { showWeb() },
            LinearLayout.LayoutParams(dp(420), dp(64)).apply { bottomMargin = dp(12) })
        buttons.addView(makeButton("↻   UYGULAMAYI YENİLE") { showHome() },
            LinearLayout.LayoutParams(dp(420), dp(64)))
        root.addView(title)
        root.addView(subtitle)
        root.addView(buttons)
        val footer = TextView(this).apply {
            text = "Kumanda: Yön tuşları ile gezin • OK ile seç • BACK ile geri dön"
            textSize = 13f
            setTextColor(Color.GRAY)
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, 0)
        }
        root.addView(footer)
        setContentView(root)
        buttons.getChildAt(0).requestFocus()
    }

    private fun showSettings() {
        val input = EditText(this).apply {
            hint = "https://.../playlist.m3u"
            setSingleLine(true)
            setText(prefs.getString("playlist_url", ""))
            setSelection(text.length)
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), 0)
            addView(TextView(this@MainActivity).apply {
                text = "M3U / M3U8 kanal listesi adresi"
                setTextColor(Color.WHITE)
                textSize = 14f
            })
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("Yayın ayarları")
            .setView(box)
            .setPositiveButton("Kaydet") { _, _ ->
                prefs.edit().putString("playlist_url", input.text.toString().trim()).apply()
            }
            .setNeutralButton("Kanalları Aç") { _, _ ->
                prefs.edit().putString("playlist_url", input.text.toString().trim()).apply()
                startActivity(Intent(this, NativeIptvActivity::class.java))
            }
            .setNegativeButton("İptal", null)
            .show()
    }

    private fun showWeb() {
        val view = WebView(this).apply {
            setBackgroundColor(bg)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowContentAccess = true
            webViewClient = WebViewClient()
        }
        web = view
        setContentView(view)
        val url = prefs.getString("remote_url", getString(R.string.default_server_url))
            ?: getString(R.string.default_server_url)
        if (prefs.getBoolean("remote_mode", true)) view.loadUrl(url)
        else view.loadUrl("file:///android_asset/www/index.html")
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode == KeyEvent.KEYCODE_MENU || event.keyCode == KeyEvent.KEYCODE_SETTINGS) {
                showSettings()
                return true
            }
            if (event.keyCode == KeyEvent.KEYCODE_BACK && web != null) {
                showHome()
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (web != null) showHome() else super.onBackPressed()
    }
}