package com.cengiz718.eymentvradyopro

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val baseAppUrl = "https://eymen-tv-radyo-pro.ai.studio/"
    private val versionJsonUrl = "https://raw.githubusercontent.com/cengiz718/EYMEN-TV-RADYO/main/public/version.json"
    private var downloadId: Long = -1L
    private var webViewDestroyed = false

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (id == downloadId && downloadId != -1L) {
                installDownloadedApk()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                downloadReceiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_EXPORTED
            )
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(
                downloadReceiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            )
        }

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)

        webView = WebView(this).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()

            cookieManager.setAcceptThirdPartyCookies(this, true)

            clearCache(true)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.userAgentString = settings.userAgentString.replace("; wv", "")

            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    super.onShowCustomView(view, callback)
                }
            }

            addJavascriptInterface(object {
                @JavascriptInterface
                fun exitApp() {
                    runOnUiThread { closeAppCompletely() }
                }
            }, "AndroidBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val targetUrl = request?.url?.toString() ?: return false
                    return !(targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))
                }
            }
        }

        setContentView(webView)
        webView.loadUrl(baseAppUrl)
        checkForAppUpdate()
    }

    private fun checkForAppUpdate() {
        thread {
            try {
                val conn = URL("$versionJsonUrl?t=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                if (conn.responseCode != 200) return@thread

                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                val remoteVersionCode = json.optInt("versionCode", 1)
                val remoteVersionName = json.optString("versionName", "")
                val apkUrl = json.optString("apkUrl", "")
                val notes = json.optString("releaseNotes", "Yeni güncelleme mevcut.")

                val pInfo = packageManager.getPackageInfo(packageName, 0)
                @Suppress("DEPRECATION")
                val currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    pInfo.longVersionCode
                } else {
                    pInfo.versionCode.toLong()
                }

                if (remoteVersionCode > currentVersionCode && apkUrl.isNotBlank()) {
                    runOnUiThread {
                        if (!isFinishing) {
                            AlertDialog.Builder(this)
                                .setTitle("Güncelleme Mevcut ($remoteVersionName)")
                                .setMessage(notes)
                                .setCancelable(true)
                                .setPositiveButton("Güncelle") { _, _ ->
                                    startApkDownload(apkUrl)
                                }
                                .setNegativeButton("Sonra", null)
                                .show()
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun startApkDownload(apkUrl: String) {
        try {
            val destFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "eymen-update.apk")
            if (destFile.exists()) destFile.delete()

            val request = DownloadManager.Request(Uri.parse(apkUrl))
                .setTitle("Eymen TV & Radyo Güncelleniyor")
                .setDescription("Yeni sürüm indiriliyor...")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "eymen-update.apk")

            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = dm.enqueue(request)
            Toast.makeText(this, "Güncelleme indiriliyor...", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "İndirme başlatılamadı: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun installDownloadedApk() {
        try {
            val apkFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "eymen-update.apk")
            if (!apkFile.exists()) return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(settingsIntent)
                Toast.makeText(this, "Güncellemenin kurulması için bu uygulamaya izin verin.", Toast.LENGTH_LONG).show()
                return
            }

            val apkUri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(installIntent)
        } catch (e: Exception) {
            Toast.makeText(this, "Kurulum açılamadı: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun closeAppCompletely() {
        if (!webViewDestroyed) {
            try {
                webView.stopLoading()
                webView.loadUrl("about:blank")
                webView.clearHistory()
                webView.removeAllViews()
                webView.destroy()
            } catch (_: Exception) {
            } finally {
                webViewDestroyed = true
            }
        }
        finishAndRemoveTask()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            closeAppCompletely()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        closeAppCompletely()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(downloadReceiver)
        } catch (_: Exception) {
        }
        if (!webViewDestroyed && ::webView.isInitialized) {
            try {
                webView.stopLoading()
                webView.removeAllViews()
                webView.destroy()
            } catch (_: Exception) {
            } finally {
                webViewDestroyed = true
            }
        }
        super.onDestroy()
    }
}
