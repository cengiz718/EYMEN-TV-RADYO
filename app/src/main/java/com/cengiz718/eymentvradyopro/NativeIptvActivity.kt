package com.cengiz718.eymentvradyopro

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
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
    private var player: ExoPlayer? = null
    private var channels: List<TvChannel> = emptyList()
    private var visibleChannels: List<TvChannel> = emptyList()
    private var currentIndex = -1
    private val accent = Color.rgb(255, 177, 72)
    private val background = Color.rgb(8, 11, 18)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(background)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        status = TextView(this).apply {
            text = "EYMEN TV RADYO PRO  •  Kanal seçin"
            textSize = 18f
            setTextColor(accent)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), dp(4))
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(42)))

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        addToolbarButton(toolbar, "◀ Önceki") { playRelative(-1) }
        addToolbarButton(toolbar, "Sonraki ▶") { playRelative(1) }
        addToolbarButton(toolbar, "Liste URL") { askUrl() }
        addToolbarButton(toolbar, "Ara") { askSearch() }
        addToolbarButton(toolbar, "Ayarlar") { showSettings() }
        root.addView(toolbar, LinearLayout.LayoutParams(-1, dp(58)))

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            contentDescription = "Video oynatıcı. Kanal değiştirmek için kumandadaki kanal tuşlarını kullanın."
        }
        body.addView(playerView, LinearLayout.LayoutParams(0, -1, 1.7f))

        val side = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, 0, 0)
        }
        count = TextView(this).apply {
            text = "KANALLAR (0)"
            textSize = 15f
            setTextColor(accent)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), dp(8))
        }
        side.addView(count, LinearLayout.LayoutParams(-1, dp(38)))
        channelList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isFocusable = false
            addView(channelList)
        }
        side.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(side, LinearLayout.LayoutParams(0, -1, 1f))
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        player = ExoPlayer.Builder(this).build().also { exo ->
            playerView.player = exo
            exo.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    status.text = "Yayın hatası: ${error.errorCodeName} • Başka kanal deneyin"
                }
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_BUFFERING) status.text = "Yayın yükleniyor..."
                    if (state == Player.STATE_READY) {
                        val name = channels.getOrNull(currentIndex)?.name ?: "Yayın"
                        status.text = "ŞİMDİ OYNATILIYOR  •  $name"
                    }
                }
            })
        }

        val savedUrl = prefs.getString("playlist_url", "").orEmpty()
        if (savedUrl.isNotBlank()) fetch(savedUrl) else askUrl()
    }

    private fun buttonBackground(): StateListDrawable {
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

    private fun addToolbarButton(parent: LinearLayout, label: String, action: () -> Unit) {
        val button = Button(this).apply {
            text = label
            textSize = 14f
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            setTextColor(Color.WHITE)
            background = buttonBackground()
            setOnClickListener { action() }
        }
        parent.addView(button, LinearLayout.LayoutParams(0, dp(50), 1f).apply {
            marginEnd = dp(5)
        })
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
            .setMessage("Size ait veya kullanma izniniz bulunan yayın listesinin adresini girin.")
            .setView(input)
            .setPositiveButton("Kaydet ve Yükle") { _, _ ->
                val url = input.text.toString().trim()
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    prefs.edit().putString("playlist_url", url).apply()
                    fetch(url)
                } else {
                    status.text = "Geçerli bir http veya https liste adresi girin."
                }
            }
            .setNegativeButton("İptal", null)
            .show()
    }

    private fun showSettings() {
        val options = arrayOf("Kanal listesini yeniden yükle", "Liste adresini değiştir", "Kanal arama", "Ana menüye dön")
        AlertDialog.Builder(this).setTitle("Eymen TV ayarları").setItems(options) { _, which ->
            when (which) {
                0 -> prefs.getString("playlist_url", "")?.takeIf { it.isNotBlank() }?.let(::fetch) ?: askUrl()
                1 -> askUrl()
                2 -> askSearch()
                3 -> finish()
            }
        }.setNegativeButton("Kapat", null).show()
    }

    private fun fetch(url: String) {
        status.text = "Kanal listesi indiriliyor..."
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 25000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "EymenTV/5.0 (Android TV)")
                connection.setRequestProperty("Accept", "*/*")
                val code = connection.responseCode
                if (code !in 200..299) throw IllegalStateException("Sunucu HTTP $code yanıtı verdi")
                val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val parsed = parseM3u(body, url)
                runOnUiThread {
                    channels = parsed
                    visibleChannels = parsed
                    renderChannels(parsed)
                    status.text = if (parsed.isEmpty()) "Listede oynatılabilir kanal bulunamadı." else "${parsed.size} kanal hazır • Kumanda ile seçin"
                }
            } catch (error: Exception) {
                runOnUiThread {
                    status.text = "Liste yüklenemedi: ${error.message ?: "Bağlantı hatası"}"
                }
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
                line.startsWith("#EXTINF", ignoreCase = true) -> {
                    name = line.substringAfterLast(',', "Kanal").trim().ifBlank { "Kanal" }
                    group = Regex("group-title=[\"']([^\"']+)", RegexOption.IGNORE_CASE)
                        .find(line)?.groupValues?.get(1) ?: "Genel"
                }
                line.startsWith("#EXTGRP:", ignoreCase = true) -> {
                    group = line.substringAfter(':').trim().ifBlank { group }
                }
                line.isNotBlank() && !line.startsWith("#") -> {
                    try {
                        val resolved = URL(URL(baseUrl), line).toString()
                        if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
                            result.add(TvChannel(name, resolved, group))
                        }
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
            val row = Button(this).apply {
                text = "${index + 1}.  ${channel.name}\n${channel.group}"
                textSize = 13f
                isAllCaps = false
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                isFocusable = true
                isFocusableInTouchMode = true
                setTextColor(Color.WHITE)
                background = buttonBackground()
                minHeight = dp(58)
                setPadding(dp(12), dp(5), dp(8), dp(5))
                setOnClickListener { play(channel, index) }
            }
            channelList.addView(row, LinearLayout.LayoutParams(-1, dp(62)).apply {
                bottomMargin = dp(5)
            })
        }
        if (items.isNotEmpty() && currentIndex < 0) channelList.getChildAt(0)?.requestFocus()
    }

    private fun askSearch() {
        val input = EditText(this).apply { hint = "Kanal adı veya kategori" }
        AlertDialog.Builder(this)
            .setTitle("Kanal ara")
            .setView(input)
            .setPositiveButton("Ara") { _, _ ->
                val query = input.text.toString().trim()
                visibleChannels = if (query.isBlank()) channels else channels.filter {
                    it.name.contains(query, true) || it.group.contains(query, true)
                }
                renderChannels(visibleChannels)
                status.text = "${visibleChannels.size} sonuç bulundu"
            }
            .setNeutralButton("Tüm kanallar") { _, _ ->
                visibleChannels = channels
                renderChannels(channels)
                status.text = "${channels.size} kanal gösteriliyor"
            }
            .setNegativeButton("İptal", null)
            .show()
    }

    private fun play(channel: TvChannel, index: Int) {
        currentIndex = channels.indexOf(channel).takeIf { it >= 0 } ?: index
        status.text = "Açılıyor: ${channel.name}"
        player?.setMediaItem(MediaItem.fromUri(channel.url))
        player?.prepare()
        player?.playWhenReady = true
        playerView.requestFocus()
    }

    private fun playRelative(direction: Int) {
        if (channels.isEmpty()) {
            status.text = "Önce kanal listesi yükleyin."
            return
        }
        val next = (currentIndex + direction + channels.size) % channels.size
        play(channels[next], next)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                    showSettings()
                    return true
                }
                KeyEvent.KEYCODE_INFO -> {
                    askSearch()
                    return true
                }
                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    if (currentFocus === playerView) {
                        playRelative(1)
                        return true
                    }
                }
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_DPAD_LEFT -> {
                    if (currentFocus === playerView) {
                        playRelative(-1)
                        return true
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
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