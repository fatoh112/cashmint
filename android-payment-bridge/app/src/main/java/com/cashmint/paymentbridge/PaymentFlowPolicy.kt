package com.cashmint.paymentbridge

enum class ReaderActionState {
    IDLE,
    DISCOVERING,
    COLLECTING,
    PROCESSING,
    CANCELLING
}

enum class PaymentDecision {
    FAIL_FINAL,
    RETRY_PROCESS_ONCE,
    UNKNOWN_RECONCILE,
    WAIT_FOR_WEBHOOK,
    SUCCEEDED_CONFIRMED,
    CANCEL_FINAL,
    KEEP_WAITING
}

object PaymentFlowPolicy {
    const val BACKEND_INTENT_TIMEOUT_MS = 15_000L
    const val RETRIEVE_INTENT_TIMEOUT_MS = 15_000L
    const val COLLECT_TIMEOUT_MS = 60_000L
    const val PROCESS_TIMEOUT_MS = 30_000L
    const val INITIAL_WEBHOOK_WAIT_MS = 15_000L
    const val TOTAL_WORKFLOW_TIMEOUT_MS = 90_000L
    const val ACTIVE_POLL_INTERVAL_MS = 2_000L
    const val UNKNOWN_BACKOFF_POLL_INTERVAL_MS = 5_000L

    private val finalStatuses = setOf("succeeded", "failed", "cancelled", "expired")
    private val recoverableStatuses = setOf("claimed", "creating_payment_intent", "waiting_for_card", "processing", "unknown")

    fun isFinalRequestStatus(status: String) = status in finalStatuses

    fun isRecoverableRequestStatus(status: String) = status in recoverableStatuses

    fun shouldClaimFromQueue(status: String) = status == "pending"

    fun decideStripeStatus(status: String, processRetryUsed: Boolean): PaymentDecision = when (status) {
        "succeeded" -> PaymentDecision.WAIT_FOR_WEBHOOK
        "requires_payment_method" -> PaymentDecision.FAIL_FINAL
        "requires_confirmation" -> if (processRetryUsed) PaymentDecision.UNKNOWN_RECONCILE else PaymentDecision.RETRY_PROCESS_ONCE
        "processing", "requires_action" -> PaymentDecision.KEEP_WAITING
        "canceled", "cancelled", "cancel_requested" -> PaymentDecision.CANCEL_FINAL
        else -> PaymentDecision.UNKNOWN_RECONCILE
    }

    fun pollDelayMs(elapsedSinceUnknownMs: Long): Long =
        if (elapsedSinceUnknownMs <= INITIAL_WEBHOOK_WAIT_MS) ACTIVE_POLL_INTERVAL_MS else UNKNOWN_BACKOFF_POLL_INTERVAL_MS
}
