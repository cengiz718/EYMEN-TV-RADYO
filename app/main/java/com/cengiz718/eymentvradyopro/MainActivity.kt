package com.cengiz718.eymentvradyopro

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val prefsName = "EymenTvPrefs"
    private val keySavedUrl = "saved_stream_url"

    private val primaryUrl = "https://cengiz718.github.io/EYMEN-TV-RADYO/"
    private val fallbackUrls = listOf(
        "https://cengiz718.github.io/EYMEN-TV-RADYO/",
        "https://eymen-tv-radyo-pro.ai.studio/"
    )
    private var fallbackIndex = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )

        webView = WebView(this)
        setContentView(webView)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!url.isNullOrBlank() && !url.startsWith("about:")) {
                    saveUrl(url)
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                val code = errorResponse?.statusCode ?: 0
                if (request?.isForMainFrame == true && (code == 404 || code >= 500)) {
                    tryNextUrlOrDialog()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    tryNextUrlOrDialog()
                }
            }
        }

        // Açılışta doğrudan kalıcı GitHub Pages adresini yükle
        webView.loadUrl(primaryUrl)
    }

    private fun tryNextUrlOrDialog() {
        if (fallbackIndex < fallbackUrls.size) {
            val nextUrl = fallbackUrls[fallbackIndex]
            fallbackIndex++
            webView.loadUrl(nextUrl)
        } else {
            showManualUrlDialog()
        }
    }

    private fun showManualUrlDialog() {
        val input = EditText(this)
        input.setText(getSavedUrl() ?: primaryUrl)
        input.setSelection(input.text.length)

        AlertDialog.Builder(this)
            .setTitle("Yayın Adresi")
            .setMessage("Adres yüklenemedi. Kullanmak istediğiniz bağlantıyı girin:")
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("KAYDET VE AÇ") { _, _ ->
                val enteredUrl = input.text.toString().trim()
                if (enteredUrl.isNotEmpty()) {
                    saveUrl(enteredUrl)
                    fallbackIndex = 0
                    webView.loadUrl(enteredUrl)
                    Toast.makeText(this, "Adres kaydedildi", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("TEKRAR DENE") { _, _ ->
                fallbackIndex = 0
                webView.loadUrl(primaryUrl)
            }
            .show()
    }

    private fun saveUrl(url: String) {
        getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .edit()
            .putString(keySavedUrl, url)
            .apply()
    }

    private fun getSavedUrl(): String? {
        return getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .getString(keySavedUrl, null)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
