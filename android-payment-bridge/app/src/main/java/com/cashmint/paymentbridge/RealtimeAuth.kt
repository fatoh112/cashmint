package com.cashmint.paymentbridge

import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class RealtimeTokenValidation(
    val valid: Boolean,
    val source: String,
    val jwtFormatValid: Boolean,
    val expiryEpochSeconds: Long?,
    val expiryDisplay: String,
    val reason: String
)

object RealtimeAuth {
    fun isRealtimeApiKeyCompatible(key: String): Boolean {
        val raw = key.trim()
        return raw.isNotBlank() && !raw.startsWith("sb_") && raw.split(".").size == 3
    }

    fun validateSessionAccessToken(
        token: String,
        anonKey: String,
        refreshToken: String,
        nowEpochSeconds: Long = System.currentTimeMillis() / 1000L
    ): RealtimeTokenValidation {
        val raw = token.trim()
        if (raw.isBlank()) return invalid("missing", false, null, "missing")
        if (raw.equals(anonKey.trim(), ignoreCase = false)) return invalid("invalid type", false, null, "publishable key")
        if (raw.startsWith("sb_")) return invalid("invalid type", false, null, "publishable key")
        if (refreshToken.isNotBlank() && raw == refreshToken.trim()) return invalid("invalid type", false, null, "refresh token")
        if (raw.startsWith("Bearer ", ignoreCase = true)) return invalid("invalid type", false, null, "Bearer prefix")

        val parts = raw.split(".")
        if (parts.size != 3 || parts.any { it.isBlank() }) return invalid("invalid type", false, null, "not a JWT")

        val expiry = runCatching {
            val payload = String(Base64.getUrlDecoder().decode(padBase64(parts[1])), StandardCharsets.UTF_8)
            Regex(""""exp"\s*:\s*(\d+)""").find(payload)?.groupValues?.getOrNull(1)?.toLongOrNull()?.takeIf { it > 0L }
        }.getOrNull()

        if (expiry == null) return invalid("invalid type", false, null, "JWT expiry missing")
        if (expiry <= nowEpochSeconds) return RealtimeTokenValidation(false, "session access token", true, expiry, formatExpiry(expiry), "expired")
        return RealtimeTokenValidation(true, "session access token", true, expiry, formatExpiry(expiry), "ok")
    }

    fun stripBearerPrefix(token: String): String =
        token.trim().removePrefix("Bearer ").removePrefix("bearer ")

    private fun invalid(source: String, jwtFormatValid: Boolean, expiry: Long?, reason: String) =
        RealtimeTokenValidation(false, source, jwtFormatValid, expiry, expiry?.let(::formatExpiry) ?: "unknown", reason)

    private fun padBase64(value: String): String {
        val remainder = value.length % 4
        return if (remainder == 0) value else value + "=".repeat(4 - remainder)
    }

    private fun formatExpiry(epochSeconds: Long): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss 'UTC'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(Date(epochSeconds * 1000L))
    }
}
