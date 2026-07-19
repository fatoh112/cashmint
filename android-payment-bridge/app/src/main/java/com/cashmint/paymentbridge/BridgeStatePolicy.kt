package com.cashmint.paymentbridge

data class LocalBridgeSnapshot(
    val activeRequestId: String?,
    val readerConnection: String,
    val readerAction: ReaderActionState,
    val hasPaymentCancelable: Boolean,
    val busy: Boolean
)

data class ServerBridgeSnapshot(
    val currentPaymentRequestId: String?,
    val readerConnection: String,
    val readerAction: ReaderActionState,
    val paymentRequestStatus: String?
)

data class LocalBridgeCorrection(
    val clearActiveRequest: Boolean,
    val cancelStaleCancelable: Boolean,
    val readerConnection: String,
    val readerAction: ReaderActionState,
    val clearBusy: Boolean,
    val movePaymentToHistory: Boolean
)

object BridgeStatePolicy {
    fun correction(local: LocalBridgeSnapshot, server: ServerBridgeSnapshot): LocalBridgeCorrection? {
        val serverIdle = server.currentPaymentRequestId.isNullOrBlank() && server.readerAction == ReaderActionState.IDLE
        val serverFinal = server.paymentRequestStatus in setOf("succeeded", "failed", "cancelled", "expired")
        if (!serverIdle && !serverFinal) return null
        val needsCorrection = !local.activeRequestId.isNullOrBlank() ||
            local.readerAction != ReaderActionState.IDLE ||
            local.hasPaymentCancelable ||
            local.busy
        if (!needsCorrection) return null
        return LocalBridgeCorrection(
            clearActiveRequest = true,
            cancelStaleCancelable = local.hasPaymentCancelable,
            readerConnection = server.readerConnection.ifBlank { local.readerConnection },
            readerAction = ReaderActionState.IDLE,
            clearBusy = true,
            movePaymentToHistory = serverFinal || !local.activeRequestId.isNullOrBlank()
        )
    }
}
