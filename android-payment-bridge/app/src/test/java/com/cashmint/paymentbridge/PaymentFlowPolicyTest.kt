package com.cashmint.paymentbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentFlowPolicyTest {
    @Test fun requiresPaymentMethodIsFinalFailed() {
        assertEquals(PaymentDecision.FAIL_FINAL, PaymentFlowPolicy.decideStripeStatus("requires_payment_method", false))
        assertEquals(PaymentDecision.FAIL_FINAL, PaymentFlowPolicy.decideStripeStatus("requires_payment_method", true))
    }

    @Test fun requiresConfirmationRetriesProcessOnlyOnce() {
        assertEquals(PaymentDecision.RETRY_PROCESS_ONCE, PaymentFlowPolicy.decideStripeStatus("requires_confirmation", false))
        assertEquals(PaymentDecision.UNKNOWN_RECONCILE, PaymentFlowPolicy.decideStripeStatus("requires_confirmation", true))
    }

    @Test fun processingAndRequiresActionKeepWaiting() {
        assertEquals(PaymentDecision.KEEP_WAITING, PaymentFlowPolicy.decideStripeStatus("processing", false))
        assertEquals(PaymentDecision.KEEP_WAITING, PaymentFlowPolicy.decideStripeStatus("requires_action", false))
    }

    @Test fun succeededWaitsForWebhookAuthority() {
        assertEquals(PaymentDecision.WAIT_FOR_WEBHOOK, PaymentFlowPolicy.decideStripeStatus("succeeded", false))
    }

    @Test fun cancellationIsFinal() {
        assertEquals(PaymentDecision.CANCEL_FINAL, PaymentFlowPolicy.decideStripeStatus("cancel_requested", false))
        assertEquals(PaymentDecision.CANCEL_FINAL, PaymentFlowPolicy.decideStripeStatus("cancelled", false))
        assertEquals(PaymentDecision.CANCEL_FINAL, PaymentFlowPolicy.decideStripeStatus("canceled", false))
    }

    @Test fun finalRequestsAreNeverClaimable() {
        listOf("succeeded", "failed", "cancelled", "expired").forEach {
            assertTrue(PaymentFlowPolicy.isFinalRequestStatus(it))
            assertFalse(PaymentFlowPolicy.shouldClaimFromQueue(it))
        }
    }

    @Test fun onlyPendingIsClaimable() {
        assertTrue(PaymentFlowPolicy.shouldClaimFromQueue("pending"))
        listOf("claimed", "creating_payment_intent", "waiting_for_card", "processing", "unknown", "failed").forEach {
            assertFalse(PaymentFlowPolicy.shouldClaimFromQueue(it))
        }
    }

    @Test fun restartRecoveryOnlyUsesRecoverableStates() {
        listOf("claimed", "creating_payment_intent", "waiting_for_card", "processing", "unknown").forEach {
            assertTrue(PaymentFlowPolicy.isRecoverableRequestStatus(it))
        }
        listOf("pending", "succeeded", "failed", "cancelled", "expired").forEach {
            assertFalse(PaymentFlowPolicy.isRecoverableRequestStatus(it))
        }
    }

    @Test fun webhookPollingBacksOffAfterInitialWindow() {
        assertEquals(2_000L, PaymentFlowPolicy.pollDelayMs(15_000L))
        assertEquals(5_000L, PaymentFlowPolicy.pollDelayMs(15_001L))
    }
}
