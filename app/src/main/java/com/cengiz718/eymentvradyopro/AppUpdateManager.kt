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
 * Checks the version manifest hosted with the app and installs the APK from the
 * single "latest" GitHub Release. Android always requires user confirmation
 * in its package installer; apps cannot silently update themselves.
 */
class AppUpdateManager(private val activity: Activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private var pendingApk: File? = null

    fun checkForUpdate() {
        worker.execute {
            try {
                val connection = (URL("$VERSION_URL?t=${System.currentTimeMillis()}").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 15000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "EymenTV-Android-Updater")
                    instanceFollowRedirects = true
                }
                val code = connection.responseCode
                if (code !in 200..299) {
                    connection.disconnect()
                    return@execute
                }
                val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                connection.disconnect()

                val remoteCode = json.optInt("versionCode", 0)
                val remoteName = json.optString("versionName", "").ifBlank { "Yeni sürüm" }
                val apkUrl = json.optString("apkUrl", "")
                val notes = json.optString("releaseNotes", "Yeni sürüm hazır.")
                if (remoteCode <= BuildConfig.VERSION_CODE || apkUrl.isBlank()) return@execute

                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        showMandatoryUpdate(remoteName, notes, apkUrl)
                    }
                }
            } catch (_: Exception) {
                // A failed network check must never prevent the installed app from opening.
            }
        }
    }

    private fun showMandatoryUpdate(version: String, notes: String, url: String) {
        AlertDialog.Builder(activity)
            .setTitle("EYMEN TV RADYO güncellemesi")
            .setMessage("Yeni sürüm $version hazır.\n\n$notes\n\nGüncellemeyi indirip Android kurulum ekranında onaylayın.")
            .setCancelable(false)
            .setPositiveButton("Güncelle") { _, _ -> download(url) }
            .show()
    }

    private fun download(url: String) {
        Toast.makeText(activity, "Güncelleme indiriliyor...", Toast.LENGTH_LONG).show()
        worker.execute {
            try {
                val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 45000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "EymenTV-Android-Updater")
                }
                if (connection.responseCode !in 200..299) throw IllegalStateException("APK indirilemedi")
                val directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: throw IllegalStateException("İndirme klasörü kullanılamıyor")
                if (!directory.exists()) directory.mkdirs()
                val apk = File(directory, "eymen-tv-update.apk")
                connection.inputStream.use { input ->
                    apk.outputStream().use { output -> input.copyTo(output) }
                }
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
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
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

    fun onActivityResult(requestCode: Int) {
        if (requestCode == REQUEST_INSTALL_PERMISSION && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (activity.packageManager.canRequestPackageInstalls()) {
                pendingApk?.let(::install)
            } else {
                Toast.makeText(activity, "APK kurulum izni verilmedi.", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun close() {
        worker.shutdownNow()
    }

    companion object {
        private const val VERSION_URL =
            "https://raw.githubusercontent.com/cengiz718/EYMEN-TV-RADYO/main/public/version.json"
        private const val REQUEST_INSTALL_PERMISSION = 6712
    }
}
