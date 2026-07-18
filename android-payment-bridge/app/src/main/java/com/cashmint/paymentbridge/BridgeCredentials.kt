package com.cashmint.paymentbridge

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/** Provisioned once by a manager using register-terminal-device. Values are
 * encrypted at rest in production with AndroidX Security EncryptedSharedPreferences. */
class BridgeCredentials(context: Context) {
    private val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val prefs = EncryptedSharedPreferences.create(context, "cashmint_bridge", masterKey, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    val supabaseUrl: String get() = prefs.getString("supabase_url", "") ?: ""
    val anonKey: String get() = prefs.getString("anon_key", "") ?: ""
    val deviceId: String get() = prefs.getString("device_id", "") ?: ""
    val locationId: String get() = prefs.getString("location_id", "") ?: ""
    val stripeLocationId: String get() = prefs.getString("stripe_location_id", "") ?: ""
    val restaurantName: String get() = prefs.getString("restaurant_name", "") ?: ""
    val locationName: String get() = prefs.getString("location_name", "") ?: ""
    fun accessToken(): String = prefs.getString("access_token", "") ?: ""
    fun refreshToken(): String = prefs.getString("refresh_token", "") ?: ""
    fun expiresAt(): Long = prefs.getLong("expires_at", 0L)
    fun tokenExpiresSoon(): Boolean = expiresAt() > 0L && expiresAt() - (System.currentTimeMillis() / 1000L) < 120L
    fun enrolled() = deviceId.isNotBlank() && accessToken().isNotBlank() && supabaseUrl.isNotBlank() && anonKey.isNotBlank()
    fun activeRequestId() = prefs.getString("active_payment_request_id", "") ?: ""
    fun setActiveRequestId(value: String?) = prefs.edit().putString("active_payment_request_id", value ?: "").apply()
    fun saveEnrollment(json: JSONObject) {
        val session = json.getJSONObject("session")
        prefs.edit()
            .putString("supabase_url", json.getString("supabase_url"))
            .putString("anon_key", json.getString("anon_key"))
            .putString("device_id", json.getString("device_id"))
            .putString("location_id", json.getString("location_id"))
            .putString("stripe_location_id", json.optString("stripe_location_id"))
            .putString("restaurant_name", json.optString("restaurant_name"))
            .putString("location_name", json.optString("location_name"))
            .putString("access_token", session.getString("access_token"))
            .putString("refresh_token", session.optString("refresh_token"))
            .putLong("expires_at", session.optLong("expires_at", 0L))
            .apply()
    }
    fun saveSession(session: JSONObject) {
        prefs.edit()
            .putString("access_token", session.getString("access_token"))
            .putString("refresh_token", session.optString("refresh_token", refreshToken()))
            .putLong("expires_at", session.optLong("expires_at", 0L))
            .apply()
    }
    fun clear() = prefs.edit().clear().apply()
}
