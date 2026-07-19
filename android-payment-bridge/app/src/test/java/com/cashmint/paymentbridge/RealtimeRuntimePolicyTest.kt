package com.cashmint.paymentbridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeRuntimePolicyTest {
    @Test fun onlyOneWebSocketConnectionExists() {
        assertFalse(RealtimeRuntimePolicy.shouldOpenSocket(
            realtimeConnecting = true,
            hasSocket = false,
            lastRealtimeAtMs = 0L,
            reconnectAfterMs = 0L,
            nowMs = 1_000L,
            tokenValid = true
        ))
        assertFalse(RealtimeRuntimePolicy.shouldOpenSocket(
            realtimeConnecting = false,
            hasSocket = true,
            lastRealtimeAtMs = 500L,
            reconnectAfterMs = 0L,
            nowMs = 1_000L,
            tokenValid = true
        ))
    }

    @Test fun reconnectDoesNotOpenDuringBackoff() {
        assertFalse(RealtimeRuntimePolicy.shouldOpenSocket(
            realtimeConnecting = false,
            hasSocket = false,
            lastRealtimeAtMs = 0L,
            reconnectAfterMs = 2_000L,
            nowMs = 1_000L,
            tokenValid = true
        ))
    }

    @Test fun malformedTokenNeverReachesSocketOpenDecision() {
        assertFalse(RealtimeRuntimePolicy.shouldOpenSocket(
            realtimeConnecting = false,
            hasSocket = false,
            lastRealtimeAtMs = 0L,
            reconnectAfterMs = 0L,
            nowMs = 1_000L,
            tokenValid = false
        ))
    }

    @Test fun opensWhenNoSocketNoBackoffAndTokenValid() {
        assertTrue(RealtimeRuntimePolicy.shouldOpenSocket(
            realtimeConnecting = false,
            hasSocket = false,
            lastRealtimeAtMs = 0L,
            reconnectAfterMs = 0L,
            nowMs = 1_000L,
            tokenValid = true
        ))
    }

    @Test fun reconnectDoesNotCreateDuplicatePollingJobs() {
        assertTrue(RealtimeRuntimePolicy.shouldStartPollingLoop(false))
        assertFalse(RealtimeRuntimePolicy.shouldStartPollingLoop(true))
    }
}
