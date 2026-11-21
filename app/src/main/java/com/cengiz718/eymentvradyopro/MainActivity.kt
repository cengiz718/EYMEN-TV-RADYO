package com.cengiz718.eymentvradyopro

import android.app.AlertDialog
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("eymen_tv_prefs", MODE_PRIVATE) }
    private var web: WebView? = null
    private lateinit var updates: AppUpdateManager
    private val bg = Color.rgb(8, 11, 18)
    private val accent = Color.rgb(255, 177, 72)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        updates = AppUpdateManager(this)
        showHome()
        updates.checkForUpdate()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun isTelevision(): Boolean =
        packageManager.hasSystemFeature("android.software.leanback")

    private fun focusBackground(): StateListDrawable {
        val drawable = StateListDrawable()
        drawable.addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
            setColor(Color.rgb(67, 76, 92))
            setStroke(dp(4), accent)
            cornerRadius = dp(12).toFloat()
        })
        drawable.addState(intArrayOf(android.R.attr.state_pressed), GradientDrawable().apply {
            setColor(Color.rgb(82, 91, 108))
            cornerRadius = dp(12).toFloat()
        })
        drawable.addState(intArrayOf(), GradientDrawable().apply {
            setColor(Color.rgb(31, 39, 52))
            setStroke(dp(1), Color.rgb(76, 86, 104))
            cornerRadius = dp(12).toFloat()
        })
        return drawable
    }

    private fun makeButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = if (isTelevision()) 18f else 16f
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            minHeight = dp(58)
            setOnClickListener { action() }
            setTextColor(Color.WHITE)
            background = focusBackground()
            setPadding(dp(18), dp(8), dp(18), dp(8))
        }

    private fun showHome() {
        disposeWeb()
        immersive()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(20), dp(24), dp(20))
            setBackgroundColor(bg)
        }
        val title = TextView(this).apply {
            text = "EYMEN TV RADYO PRO"
            textSize = if (isTelevision()) 32f else 25f
            setTextColor(accent)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(8))
        }
        val subtitle = TextView(this).apply {
            text = "Telefon • Tablet • Android TV • Mi Box"
            textSize = 14f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(20))
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        val width = if (isTelevision()) dp(460) else -1
        val lp = LinearLayout.LayoutParams(width, dp(62)).apply { bottomMargin = dp(10) }
        buttons.addView(makeButton("▶   CANLI TV / KANALLAR") {
            startActivity(Intent(this, NativeIptvActivity::class.java))
        }, lp)
        buttons.addView(makeButton("⚙   YAYIN LİSTESİ VE AYARLAR") { showSettings() },
            LinearLayout.LayoutParams(width, dp(62)).apply { bottomMargin = dp(10) })
        buttons.addView(makeButton("▣   WEB UYGULAMASINI AÇ") { showWeb() },
            LinearLayout.LayoutParams(width, dp(62)).apply { bottomMargin = dp(10) })
        buttons.addView(makeButton("↻   GÜNCELLEME KONTROLÜ") { updates.checkForUpdate() },
            LinearLayout.LayoutParams(width, dp(62)))
        root.addView(title)
        root.addView(subtitle)
        root.addView(buttons, LinearLayout.LayoutParams(if (isTelevision()) -2 else -1, -2))
        root.addView(TextView(this).apply {
            text = "Kumanda: yön tuşları • OK: seç • BACK: çık"
            textSize = 12f
            setTextColor(Color.GRAY)
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        })
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
        AlertDialog.Builder(this)
            .setTitle("Yayın ayarları")
            .setMessage("M3U / M3U8 kanal listesi adresi")
            .setView(input)
            .setPositiveButton("Kaydet") { _, _ ->
                prefs.edit().putString("playlist_url", input.text.toString().trim()).apply()
            }
            .setNeutralButton("Kanalları aç") { _, _ ->
                prefs.edit().putString("playlist_url", input.text.toString().trim()).apply()
                startActivity(Intent(this, NativeIptvActivity::class.java))
            }
            .setNegativeButton("İptal", null)
            .show()
    }

    private fun showWeb() {
        disposeWeb()
        immersive()
        val view = WebView(this).apply {
            setBackgroundColor(bg)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowContentAccess = true
            settings.loadsImagesAutomatically = true
            webViewClient = WebViewClient()
        }
        web = view
        setContentView(view)
        val url = prefs.getString("remote_url", getString(R.string.default_server_url))
            ?: getString(R.string.default_server_url)
        if (prefs.getBoolean("remote_mode", true)) view.loadUrl(url)
        else view.loadUrl("file:///android_asset/www/index.html")
    }

    private fun disposeWeb() {
        web?.let { view ->
            view.stopLoading()
            view.onPause()
            view.loadUrl("about:blank")
            view.removeAllViews()
            view.destroy()
        }
        web = null
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        immersive()
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
        if (web != null) showHome() else finish()
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        updates.onActivityResult(requestCode, resultCode)
    }

    override fun onStop() {
        web?.onPause()
        super.onStop()
    }

    override fun onDestroy() {
        disposeWeb()
        updates.close()
        super.onDestroy()
    }
}