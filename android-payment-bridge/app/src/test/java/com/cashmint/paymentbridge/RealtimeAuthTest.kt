package com.cashmint.paymentbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.util.Base64

class RealtimeAuthTest {
    @Test fun rejectsPublishableSbValues() {
        val validation = RealtimeAuth.validateSessionAccessToken("sb_publishable_abc", "sb_publishable_abc", "refresh")
        assertFalse(validation.valid)
        assertEquals("publishable key", validation.reason)
    }

    @Test fun rejectsRefreshTokens() {
        val validation = RealtimeAuth.validateSessionAccessToken("refresh-token", "anon", "refresh-token")
        assertFalse(validation.valid)
        assertEquals("refresh token", validation.reason)
    }

    @Test fun rejectsBearerPrefix() {
        val validation = RealtimeAuth.validateSessionAccessToken("Bearer ${jwt()}", "anon", "refresh")
        assertFalse(validation.valid)
        assertEquals("Bearer prefix", validation.reason)
    }

    @Test fun acceptsRawUnexpiredJwt() {
        val validation = RealtimeAuth.validateSessionAccessToken(jwt(exp = 2_000L), "anon", "refresh", nowEpochSeconds = 1_000L)
        assertTrue(validation.valid)
        assertTrue(validation.jwtFormatValid)
        assertEquals(2_000L, validation.expiryEpochSeconds)
    }

    @Test fun rejectsExpiredJwtBeforeConnecting() {
        val validation = RealtimeAuth.validateSessionAccessToken(jwt(exp = 999L), "anon", "refresh", nowEpochSeconds = 1_000L)
        assertFalse(validation.valid)
        assertEquals("expired", validation.reason)
    }

    @Test fun refreshedAccessTokenIsTheCurrentCandidate() {
        val oldToken = jwt(exp = 1_500L)
        val refreshedToken = jwt(exp = 3_000L)
        val oldValidation = RealtimeAuth.validateSessionAccessToken(oldToken, "anon", "refresh", nowEpochSeconds = 1_000L)
        val refreshedValidation = RealtimeAuth.validateSessionAccessToken(refreshedToken, "anon", "refresh", nowEpochSeconds = 1_000L)
        assertTrue(oldValidation.valid)
        assertTrue(refreshedValidation.valid)
        assertTrue(refreshedValidation.expiryEpochSeconds!! > oldValidation.expiryEpochSeconds!!)
    }

    @Test fun malformedTokenNeverQualifiesForWebSocket() {
        listOf("", "abc.def", "abc.def.ghi.jkl", "not-a-jwt").forEach {
            assertFalse(RealtimeAuth.validateSessionAccessToken(it, "anon", "refresh").valid)
        }
    }

    @Test fun modernPublishableKeyCannotBeUsedForRealtimeHandshake() {
        assertFalse(RealtimeAuth.isRealtimeApiKeyCompatible("sb_publishable_abc"))
    }

    @Test fun legacyAnonJwtCanBeUsedForRealtimeHandshake() {
        assertTrue(RealtimeAuth.isRealtimeApiKeyCompatible(jwt()))
    }

    private fun jwt(exp: Long = 4_000_000_000L): String {
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val header = encoder.encodeToString("""{"alg":"none","typ":"JWT"}""".toByteArray(StandardCharsets.UTF_8))
        val payload = encoder.encodeToString("""{"sub":"bridge","exp":$exp}""".toByteArray(StandardCharsets.UTF_8))
        return "$header.$payload.signature"
    }
}
