package com.cengiz718.eymentvradyopro

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
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
    private lateinit var list: LinearLayout
    private var player: ExoPlayer? = null
    private var channels = listOf<TvChannel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(8,11,17)); setPadding(12,8,12,8) }
        status = TextView(this).apply { text = "EYMEN TV RADYO PRO • M3U/M3U8"; setTextColor(Color.WHITE); textSize = 18f; setPadding(8,8,8,8) }
        playerView = PlayerView(this).apply { useController = true }
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = android.widget.ScrollView(this).apply { addView(list) }
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val load = TextView(this).apply { text = "Liste adresi"; setTextColor(Color.WHITE); textSize = 16f; setPadding(14,14,14,14); setOnClickListener { askUrl() }; isFocusable = true }
        val search = TextView(this).apply { text = "Ara"; setTextColor(Color.WHITE); textSize = 16f; setPadding(14,14,14,14); setOnClickListener { askSearch() }; isFocusable = true }
        controls.addView(load); controls.addView(search)
        root.addView(status); root.addView(playerView, LinearLayout.LayoutParams(-1,0,1.1f)); root.addView(controls); root.addView(scroll, LinearLayout.LayoutParams(-1,0,1f))
        setContentView(root)
        player = ExoPlayer.Builder(this).build().also { playerView.player = it; it.addListener(object: Player.Listener {
            override fun onPlayerError(error: PlaybackException) { status.text = "Yayın açılamadı: ${error.errorCodeName}" }
            override fun onPlaybackStateChanged(state: Int) { if(state == Player.STATE_READY) status.text = "Yayın oynatılıyor" }
        }) }
        askUrl()
    }
    private fun askUrl() {
        val input = EditText(this).apply { setSingleLine(); hint = "https://.../playlist.m3u"; setText(prefs.getString("playlist_url","")) }
        AlertDialog.Builder(this).setTitle("M3U / M3U8 adresi").setView(input).setPositiveButton("Yükle") { _,_ ->
            val url = input.text.toString().trim()
            if(url.isNotBlank()) { prefs.edit().putString("playlist_url",url).apply(); fetch(url) }
        }.setNegativeButton("İptal",null).show()
    }
    private fun fetch(url: String) {
        status.text = "Kanal listesi yükleniyor..."
        io.execute {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 20000; c.setRequestProperty("User-Agent","EymenTV/4.0")
                val body = c.inputStream.bufferedReader().use { it.readText() }; c.disconnect()
                val result = mutableListOf<TvChannel>(); var name = "Kanal"; var group = "Genel"
                body.lineSequence().forEach { line ->
                    val s = line.trim()
                    if(s.startsWith("#EXTINF",true)) {
                        name = s.substringAfterLast(',',"Kanal").trim().ifBlank { "Kanal" }
                        group = Regex("group-title=[\"']([^\"']+)",RegexOption.IGNORE_CASE).find(s)?.groupValues?.get(1) ?: "Genel"
                    } else if((s.startsWith("http://") || s.startsWith("https://")) && !s.startsWith("#")) { result.add(TvChannel(name,s,group)); name="Kanal"; group="Genel" }
                }
                runOnUiThread { channels=result; render(result); status.text = "${result.size} kanal yüklendi" }
            } catch(e: Exception) { runOnUiThread { status.text = "Liste yüklenemedi: ${e.message}" } }
        }
    }
    private fun render(items: List<TvChannel>) {
        list.removeAllViews()
        items.take(1500).forEach { channel ->
            val row = TextView(this).apply {
                text = "${channel.name}  •  ${channel.group}"; textSize=15f; setTextColor(Color.WHITE); setPadding(14,13,14,13); isFocusable=true
                setOnClickListener { play(channel) }
                setOnKeyListener { _,key,event -> if(event.action==KeyEvent.ACTION_DOWN && (key==KeyEvent.KEYCODE_DPAD_CENTER || key==KeyEvent.KEYCODE_ENTER)){play(channel);true}else false }
            }
            list.addView(row)
        }
    }
    private fun askSearch() {
        val input=EditText(this).apply { hint="Kanal veya kategori" }
        AlertDialog.Builder(this).setTitle("Kanal ara").setView(input).setPositiveButton("Ara") { _,_ ->
            val q=input.text.toString().trim()
            render(channels.filter { it.name.contains(q,true) || it.group.contains(q,true) })
        }.setNegativeButton("Tümü") { _,_ -> render(channels) }.show()
    }
    private fun play(ch: TvChannel) { status.text="Açılıyor: ${ch.name}"; player?.setMediaItem(MediaItem.fromUri(ch.url)); player?.prepare(); player?.playWhenReady=true }
    override fun onKeyDown(keyCode:Int,event:KeyEvent?):Boolean { if(keyCode==KeyEvent.KEYCODE_MENU || keyCode==KeyEvent.KEYCODE_INFO){askUrl();return true}; return super.onKeyDown(keyCode,event) }
    override fun onDestroy() { playerView.player=null; player?.release(); player=null; io.shutdownNow(); super.onDestroy() }
}