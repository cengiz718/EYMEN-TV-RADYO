package com.cengiz718.eymentvradyopro

import android.app.Activity
import android.app.AlertDialog
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

private data class TvChannel(val name: String, val url: String, val group: String)

class NativeIptvActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("eymen_tv_prefs", MODE_PRIVATE) }
    private lateinit var playerView: PlayerView
    private lateinit var status: TextView
    private lateinit var count: TextView
    private lateinit var channelList: LinearLayout
    private lateinit var listScroll: ScrollView
    private var player: ExoPlayer? = null
    private var channels: List<TvChannel> = emptyList()
    private var currentIndex = -1
    private var wasPlaying = false
    private val accent = Color.rgb(255, 177, 72)
    private val background = Color.rgb(8, 11, 18)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        immersive()
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildPlayer()
        buildScreen()
        val savedUrl = prefs.getString("playlist_url", "").orEmpty()
        if (savedUrl.isNotBlank()) fetch(savedUrl) else askUrl()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        immersive()
        buildScreen()
    }

    private fun buildPlayer() {
        player = ExoPlayer.Builder(this).build().also { exo ->
            exo.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    status.text = "Yayın hatası: ${error.errorCodeName}"
                }
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_BUFFERING) status.text = "Yayın yükleniyor..."
                    if (state == Player.STATE_READY) {
                        status.text = "ŞİMDİ OYNATILIYOR • ${channels.getOrNull(currentIndex)?.name ?: "Yayın"}"
                    }
                }
            })
        }
    }

    private fun focusBackground(): StateListDrawable {
        val drawable = StateListDrawable()
        drawable.addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
            setColor(Color.rgb(65, 73, 88))
            setStroke(dp(3), accent)
            cornerRadius = dp(9).toFloat()
        })
        drawable.addState(intArrayOf(android.R.attr.state_pressed), GradientDrawable().apply {
            setColor(Color.rgb(80, 88, 104))
            cornerRadius = dp(9).toFloat()
        })
        drawable.addState(intArrayOf(), GradientDrawable().apply {
            setColor(Color.rgb(31, 39, 52))
            setStroke(dp(1), Color.rgb(76, 86, 104))
            cornerRadius = dp(9).toFloat()
        })
        return drawable
    }

    private fun makeButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 13f
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            setTextColor(Color.WHITE)
            background = focusBackground()
            setOnClickListener { action() }
        }

    private fun buildScreen() {
        val landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val root = LinearLayout(this).apply {
            orientation = if (landscape) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            setBackgroundColor(background)
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }

        status = TextView(this).apply {
            text = "EYMEN TV RADYO PRO • Kanal seçin"
            textSize = 16f
            setTextColor(accent)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
        }

        playerView = PlayerView(this).apply {
            player = this@NativeIptvActivity.player
            useController = true
            controllerAutoShow = true
            controllerShowTimeoutMs = 4000
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            contentDescription = "Video oynatıcı. Dokunarak oynatıcı kontrollerini açın."
        }

        channelList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        listScroll = ScrollView(this).apply {
            isFillViewport = true
            isFocusable = false
            addView(channelList)
        }
        count = TextView(this).apply {
            text = "KANALLAR (0)"
            textSize = 14f
            setTextColor(accent)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
        }

        if (landscape) {
            val videoColumn = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(playerView, LinearLayout.LayoutParams(-1, 0, 1f))
            }
            root.addView(videoColumn, LinearLayout.LayoutParams(0, -1, 1.55f))
            val side = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(8), 0, 0, 0)
            }
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(makeButton("⚙ Ayar") { showSettings() }, LinearLayout.LayoutParams(0, dp(48), 1f))
            actions.addView(makeButton("⌕ Ara") { askSearch() }, LinearLayout.LayoutParams(0, dp(48), 1f))
            actions.addView(makeButton("↻ Liste") { reloadList() }, LinearLayout.LayoutParams(0, dp(48), 1f))
            side.addView(actions)
            side.addView(count, LinearLayout.LayoutParams(-1, dp(36)))
            side.addView(listScroll, LinearLayout.LayoutParams(-1, 0, 1f))
            root.addView(side, LinearLayout.LayoutParams(0, -1, 1f))
        } else {
            root.addView(status, LinearLayout.LayoutParams(-1, dp(34)))
            val actionsScroll = HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                isFillViewport = false
            }
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(makeButton("⚙ Ayarlar") { showSettings() }, LinearLayout.LayoutParams(dp(112), dp(46)).apply { marginEnd = dp(6) })
            actions.addView(makeButton("⌕ Kanal ara") { askSearch() }, LinearLayout.LayoutParams(dp(112), dp(46)).apply { marginEnd = dp(6) })
            actions.addView(makeButton("↻ Listeyi yükle") { reloadList() }, LinearLayout.LayoutParams(dp(132), dp(46)).apply { marginEnd = dp(6) })
            actions.addView(makeButton("‹ Önceki") { playRelative(-1) }, LinearLayout.LayoutParams(dp(104), dp(46)).apply { marginEnd = dp(6) })
            actions.addView(makeButton("Sonraki ›") { playRelative(1) }, LinearLayout.LayoutParams(dp(104), dp(46)))
            actionsScroll.addView(actions)
            root.addView(actionsScroll, LinearLayout.LayoutParams(-1, dp(50)))
            root.addView(playerView, LinearLayout.LayoutParams(-1, dp(238)))
            root.addView(count, LinearLayout.LayoutParams(-1, dp(34)))
            root.addView(listScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        setContentView(root)
        if (channels.isNotEmpty()) renderChannels(channels)
    }

    private fun askUrl() {
        val input = EditText(this).apply {
            hint = "https://.../playlist.m3u"
            setSingleLine(true)
            setText(prefs.getString("playlist_url", ""))
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("M3U / M3U8 kanal listesi")
            .setMessage("Kendi yayın listenizin adresini girin.")
            .setView(input)
            .setPositiveButton("Kaydet ve yükle") { _, _ ->
                val url = input.text.toString().trim()
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    prefs.edit().putString("playlist_url", url).apply()
                    fetch(url)
                } else status.text = "Geçerli bir http veya https adresi girin."
            }
            .setNegativeButton("İptal", null)
            .show()
    }

    private fun showSettings() {
        val options = arrayOf("Kanal listesini yeniden yükle", "Liste adresini değiştir", "Kanal arama", "Önceki kanal", "Sonraki kanal", "Ana menüye dön")
        AlertDialog.Builder(this).setTitle("Eymen TV ayarları").setItems(options) { _, which ->
            when (which) {
                0 -> reloadList()
                1 -> askUrl()
                2 -> askSearch()
                3 -> playRelative(-1)
                4 -> playRelative(1)
                5 -> finish()
            }
        }.setNegativeButton("Kapat", null).show()
    }

    private fun reloadList() {
        val url = prefs.getString("playlist_url", "").orEmpty()
        if (url.isBlank()) askUrl() else fetch(url)
    }

    private fun fetch(url: String) {
        status.text = "Kanal listesi yükleniyor..."
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 25000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "EymenTV/6.0 (Android)")
                connection.setRequestProperty("Accept", "*/*")
                val code = connection.responseCode
                if (code !in 200..299) throw IllegalStateException("HTTP $code")
                val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val parsed = parseM3u(body, url)
                runOnUiThread {
                    channels = parsed
                    currentIndex = -1
                    renderChannels(parsed)
                    status.text = if (parsed.isEmpty()) "Kanal bulunamadı." else "${parsed.size} kanal hazır."
                }
            } catch (error: Exception) {
                runOnUiThread { status.text = "Liste yüklenemedi: ${error.message ?: "Bağlantı hatası"}" }
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun parseM3u(body: String, baseUrl: String): List<TvChannel> {
        val result = mutableListOf<TvChannel>()
        var name = "Kanal"
        var group = "Genel"
        body.lineSequence().forEach { raw ->
            val line = raw.trim().removePrefix("\uFEFF")
            when {
                line.startsWith("#EXTINF", true) -> {
                    name = line.substringAfterLast(',', "Kanal").trim().ifBlank { "Kanal" }
                    group = Regex("group-title=[\"']([^\"']+)", RegexOption.IGNORE_CASE)
                        .find(line)?.groupValues?.get(1) ?: "Genel"
                }
                line.startsWith("#EXTGRP:", true) -> group = line.substringAfter(':').trim().ifBlank { group }
                line.isNotBlank() && !line.startsWith("#") -> {
                    try {
                        val resolved = URL(URL(baseUrl), line).toString()
                        if (resolved.startsWith("http://") || resolved.startsWith("https://")) result.add(TvChannel(name, resolved, group))
                    } catch (_: Exception) { }
                    name = "Kanal"
                    group = "Genel"
                }
            }
        }
        return result
    }

    private fun renderChannels(items: List<TvChannel>) {
        channelList.removeAllViews()
        count.text = "KANALLAR (${items.size})"
        items.forEachIndexed { index, channel ->
            val row = makeButton("${index + 1}. ${channel.name}\n${channel.group}") {
                play(channel)
            }.apply {
                textSize = 13f
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                minHeight = dp(58)
                setPadding(dp(12), dp(4), dp(8), dp(4))
            }
            channelList.addView(row, LinearLayout.LayoutParams(-1, dp(62)).apply { bottomMargin = dp(4) })
        }
        if (items.isNotEmpty() && currentIndex < 0 && !isFinishing) channelList.getChildAt(0)?.requestFocus()
    }

    private fun askSearch() {
        val input = EditText(this).apply { hint = "Kanal adı veya kategori" }
        AlertDialog.Builder(this).setTitle("Kanal ara").setView(input)
            .setPositiveButton("Ara") { _, _ ->
                val q = input.text.toString().trim()
                val filtered = if (q.isBlank()) channels else channels.filter {
                    it.name.contains(q, true) || it.group.contains(q, true)
                }
                renderChannels(filtered)
                status.text = "${filtered.size} sonuç bulundu."
            }
            .setNeutralButton("Tüm kanallar") { _, _ -> renderChannels(channels); status.text = "${channels.size} kanal gösteriliyor." }
            .setNegativeButton("İptal", null).show()
    }

    private fun play(channel: TvChannel) {
        currentIndex = channels.indexOf(channel)
        status.text = "Açılıyor: ${channel.name}"
        player?.setMediaItem(MediaItem.fromUri(channel.url))
        player?.prepare()
        player?.playWhenReady = true
        playerView.requestFocus()
        playerView.showController()
    }

    private fun playRelative(direction: Int) {
        if (channels.isEmpty()) {
            status.text = "Önce kanal listesi yükleyin."
            return
        }
        val next = (currentIndex + direction + channels.size) % channels.size
        play(channels[next])
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> { showSettings(); return true }
                KeyEvent.KEYCODE_INFO -> { askSearch(); return true }
                KeyEvent.KEYCODE_CHANNEL_UP -> { playRelative(1); return true }
                KeyEvent.KEYCODE_CHANNEL_DOWN -> { playRelative(-1); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onStart() {
        super.onStart()
        if (wasPlaying) player?.play()
    }

    override fun onStop() {
        wasPlaying = player?.isPlaying == true
        player?.pause()
        super.onStop()
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        finish()
    }

    override fun onDestroy() {
        playerView.player = null
        player?.release()
        player = null
        io.shutdownNow()
        window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}