package com.cengiz718.eymentvradyopro

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Checks the latest GitHub Release and presents a mandatory update gate when a newer APK exists.
 * Android still requires the user to approve installation in the system package installer.
 */
class AppUpdateManager(private val activity: Activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private var pendingApk: File? = null

    fun checkForUpdate() {
        worker.execute {
            try {
                val connection = (URL(RELEASE_API).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 15000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "EymenTV-Android-Updater")
                    setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                }
                val code = connection.responseCode
                if (code !in 200..299) {
                    connection.disconnect()
                    return@execute
                }
                val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                connection.disconnect()
                val tag = json.optString("tag_name").removePrefix("v")
                val assetList = json.optJSONArray("assets") ?: return@execute
                var apkUrl: String? = null
                for (i in 0 until assetList.length()) {
                    val asset = assetList.getJSONObject(i)
                    if (asset.optString("name").endsWith(".apk", true)) {
                        apkUrl = asset.optString("browser_download_url")
                        break
                    }
                }
                if (apkUrl.isNullOrBlank() || compareVersions(tag, BuildConfig.VERSION_NAME) <= 0) return@execute
                activity.runOnUiThread { showMandatoryUpdate(tag, apkUrl) }
            } catch (_: Exception) {
                // A network/API failure must not prevent the currently installed app from opening.
            }
        }
    }

    private fun compareVersions(remote: String, local: String): Int {
        val a = remote.split(".").map { it.toIntOrNull() ?: 0 }
        val b = local.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val diff = (a.getOrElse(i) { 0 }).compareTo(b.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return 0
    }

    private fun showMandatoryUpdate(version: String, url: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        AlertDialog.Builder(activity)
            .setTitle("Zorunlu güncelleme")
            .setMessage("EYMEN TV RADYO PRO $version sürümü hazır. Devam etmek için güncellemeyi indirip Android kurulum ekranında onaylayın.")
            .setCancelable(false)
            .setPositiveButton("Güncelle") { _, _ -> download(url) }
            .setNegativeButton("Daha sonra") { _, _ ->
                Toast.makeText(activity, "Yeni sürüm yüklenene kadar eski sürümle devam edebilirsiniz.", Toast.LENGTH_LONG).show()
            }
            .show()
    }

    private fun download(url: String) {
        Toast.makeText(activity, "Güncelleme indiriliyor...", Toast.LENGTH_LONG).show()
        worker.execute {
            try {
                val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "EymenTV-Android-Updater")
                }
                if (connection.responseCode !in 200..299) throw IllegalStateException("APK indirilemedi")
                val directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: throw IllegalStateException("İndirme klasörü kullanılamıyor")
                if (!directory.exists()) directory.mkdirs()
                val apk = File(directory, "eymen-tv-update.apk")
                connection.inputStream.use { input -> apk.outputStream().use { output -> input.copyTo(output) } }
                connection.disconnect()
                if (apk.length() < 1024) throw IllegalStateException("İndirilen APK geçersiz")
                pendingApk = apk
                activity.runOnUiThread { install(apk) }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    Toast.makeText(activity, "Güncelleme hatası: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun install(apk: File) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !activity.packageManager.canRequestPackageInstalls()) {
                pendingApk = apk
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"))
                activity.startActivityForResult(settingsIntent, REQUEST_INSTALL_PERMISSION)
                return
            }
            val uri = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", apk
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (error: Exception) {
            Toast.makeText(activity, "Kurulum başlatılamadı: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int) {
        if (requestCode == REQUEST_INSTALL_PERMISSION && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (activity.packageManager.canRequestPackageInstalls()) pendingApk?.let(::install)
            else Toast.makeText(activity, "APK kurulum izni verilmedi.", Toast.LENGTH_LONG).show()
        }
    }

    fun close() {
        worker.shutdownNow()
    }

    companion object {
        private const val RELEASE_API = "https://api.github.com/repos/cengiz718/EYMEN-TV-RADYO/releases/latest"
        private const val REQUEST_INSTALL_PERMISSION = 6712
    }
}