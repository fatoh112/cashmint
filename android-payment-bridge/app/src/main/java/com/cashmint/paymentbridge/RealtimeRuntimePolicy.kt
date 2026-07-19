package com.cashmint.paymentbridge

object RealtimeRuntimePolicy {
    fun shouldOpenSocket(
        realtimeConnecting: Boolean,
        hasSocket: Boolean,
        lastRealtimeAtMs: Long,
        reconnectAfterMs: Long,
        nowMs: Long,
        tokenValid: Boolean
    ): Boolean {
        if (!tokenValid) return false
        if (realtimeConnecting) return false
        if (hasSocket && nowMs - lastRealtimeAtMs < 60_000L) return false
        if (nowMs < reconnectAfterMs) return false
        return true
    }

    fun shouldStartPollingLoop(alreadyStarted: Boolean): Boolean = !alreadyStarted
}
