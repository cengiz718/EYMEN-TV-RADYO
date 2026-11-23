package com.cengiz718.eymentvradyopro

import android.annotation.SuppressLint
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
import android.view.Window
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
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var updateManager: AppUpdateManager

    private val appUrl = "https://eymen-tv-radyo-pro.ai.studio/"
    private var downloadId: Long = -1L
    private var webViewDestroyed = false
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (id == downloadId && downloadId != -1L) installDownloadedApk()
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
            registerReceiver(downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)

        webView = WebView(this).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()

            cookieManager.setAcceptThirdPartyCookies(this, true)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                cacheMode = WebSettings.LOAD_DEFAULT
                loadWithOverviewMode = true
                useWideViewPort = true
                builtInZoomControls = false
                displayZoomControls = false
                allowFileAccess = false
                allowContentAccess = true
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null) return
                    fullscreenView = view
                    fullscreenCallback = callback
                    window.setFlags(
                        WindowManager.LayoutParams.FLAG_FULLSCREEN,
                        WindowManager.LayoutParams.FLAG_FULLSCREEN
                    )
                    window.decorView.systemUiVisibility =
                        View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    setContentView(view)
                }

                override fun onHideCustomView() {
                    fullscreenCallback?.onCustomViewHidden()
                    fullscreenCallback = null
                    fullscreenView = null
                    window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                    window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    setContentView(webView)
                }
            }

            addJavascriptInterface(object {
                @JavascriptInterface
                fun exitApp() {
                    runOnUiThread { closeAppCompletely() }
                }
            }, "AndroidBridge")

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: android.webkit.WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        view?.loadDataWithBaseURL(
                            appUrl,
                            "<html><body style='background:#0b0b0b;color:white;font-family:sans-serif;text-align:center;padding:40px'><h2>EYMEN TV RADYO</h2><p>Yayın bağlantısı yeniden deneniyor...</p><script>setTimeout(function(){location.href='$appUrl'},1500)</script></body></html>",
                            "text/html",
                            "UTF-8",
                            null
                        )
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val target = request?.url?.toString() ?: return false
                    return target.startsWith("intent:") || target.startsWith("market:")
                }
            }
        }

        setContentView(webView)
        webView.loadUrl(appUrl)

        updateManager = AppUpdateManager(this)
        updateManager.checkForUpdate()
    }

    private fun startApkDownload(apkUrl: String) {
        try {
            val request = DownloadManager.Request(Uri.parse(apkUrl))
                .setTitle("Eymen TV & Radyo güncelleniyor")
                .setDescription("Yeni sürüm indiriliyor...")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(
                    this,
                    Environment.DIRECTORY_DOWNLOADS,
                    "eymen-update.apk"
                )

            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = dm.enqueue(request)
            Toast.makeText(this, "Güncelleme indiriliyor...", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(
                this,
                "İndirme başlatılamadı: " + e.message,
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun installDownloadedApk() {
        try {
            val apkFile = File(
                getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                "eymen-update.apk"
            )
            if (!apkFile.exists()) return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !packageManager.canRequestPackageInstalls()
            ) {
                startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:$packageName")
                    }
                )
                Toast.makeText(
                    this,
                    "Kurulum iznini açın, ardından güncellemeyi kurun.",
                    Toast.LENGTH_LONG
                ).show()
                return
            }

            val apkUri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                apkFile
            )

            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        } catch (e: Exception) {
            Toast.makeText(
                this,
                "Kurulum açılamadı: " + e.message,
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun closeAppCompletely() {
        if (!webViewDestroyed && ::webView.isInitialized) {
            try {
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
                fullscreenView = null
                webView.stopLoading()
                webView.onPause()
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
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
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
        if (::updateManager.isInitialized) updateManager.close()
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
