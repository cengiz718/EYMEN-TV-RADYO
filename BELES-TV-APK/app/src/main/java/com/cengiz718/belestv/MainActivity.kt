package com.cengiz718.belestv

import android.app.AlertDialog
import android.os.Bundle
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class Channel(val name: String, val url: String)

class MainActivity : AppCompatActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var adapter: ChannelAdapter
    private lateinit var status: TextView
    private val executor = Executors.newSingleThreadExecutor()
    private val channels = mutableListOf<Channel>()
    private val prefs by lazy { getSharedPreferences("beles_tv", MODE_PRIVATE) }
    private val defaultSource = "https://raw.githubusercontent.com/cengiz718/EYMEN-TV-RADYO/main/BELES-TV-APK/playlist.m3u"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        player = ExoPlayer.Builder(this).build()
        findViewById<androidx.media3.ui.PlayerView>(R.id.playerView).player = player
        adapter = ChannelAdapter(channels) { channel ->
            status.text = "Oynatılıyor: " + channel.name
            player.setMediaItem(MediaItem.fromUri(channel.url))
            player.prepare()
            player.play()
        }
        findViewById<RecyclerView>(R.id.channelList).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = this@MainActivity.adapter
        }
        findViewById<MaterialButton>(R.id.sourceButton).setOnClickListener { showSourceDialog() }
        loadPlaylist(prefs.getString("source", defaultSource) ?: defaultSource)
    }

    private fun showSourceDialog() {
        val input = EditText(this).apply {
            setText(prefs.getString("source", defaultSource))
            hint = "https://.../playlist.m3u"
            setPadding(30, 20, 30, 20)
        }
        AlertDialog.Builder(this)
            .setTitle("M3U kaynak adresi")
            .setMessage("Yalnızca erişim hakkınız olan yayın listelerini kullanın.")
            .setView(input)
            .setNegativeButton("İptal", null)
            .setPositiveButton("Yükle") { _, _ ->
                val source = input.text.toString().trim()
                if (source.isNotEmpty()) {
                    prefs.edit().putString("source", source).apply()
                    loadPlaylist(source)
                }
            }.show()
    }

    private fun loadPlaylist(source: String) {
        status.text = "Yayın listesi yükleniyor..."
        executor.execute {
            try {
                val conn = URL(source).openConnection() as HttpURLConnection
                conn.connectTimeout = 10000
                conn.readTimeout = 15000
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                val parsed = parseM3u(text)
                runOnUiThread {
                    channels.clear()
                    channels.addAll(parsed)
                    adapter.notifyDataSetChanged()
                    status.text = if (parsed.isEmpty()) "Kanal bulunamadı." else parsed.size.toString() + " kanal hazır."
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = "Liste alınamadı: " + (e.message ?: "bağlantı hatası") }
            }
        }
    }

    private fun parseM3u(text: String): List<Channel> {
        val result = mutableListOf<Channel>()
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        var pendingName: String? = null
        for (line in lines) {
            if (line.startsWith("#EXTINF", ignoreCase = true)) {
                pendingName = line.substringAfter(",", "Kanal").trim()
            } else if (!line.startsWith("#") && pendingName != null) {
                result += Channel(pendingName!!, line)
                pendingName = null
            }
        }
        return result
    }

    override fun onDestroy() {
        executor.shutdownNow()
        player.release()
        super.onDestroy()
    }
}

class ChannelAdapter(private val items: List<Channel>, private val onClick: (Channel) -> Unit) : RecyclerView.Adapter<ChannelAdapter.Holder>() {
    class Holder(val view: TextView) : RecyclerView.ViewHolder(view)
    override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): Holder {
        val view = android.view.LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false) as TextView
        return Holder(view)
    }
    override fun onBindViewHolder(holder: Holder, position: Int) {
        holder.view.text = items[position].name
        holder.view.setOnClickListener { onClick(items[position]) }
    }
    override fun getItemCount() = items.size
}
