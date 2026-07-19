package com.cashmint.paymentbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeStatePolicyTest {
    @Test fun localProcessingServerIdleRequiresSdkCancellationFirst() {
        val correction = BridgeStatePolicy.correction(
            LocalBridgeSnapshot("req_1", "connected", ReaderActionState.PROCESSING, hasPaymentCancelable = true, busy = true),
            ServerBridgeSnapshot(null, "connected", ReaderActionState.IDLE, null)
        )
        assertNotNull(correction)
        assertEquals(ReaderActionState.CANCELLING, correction!!.readerAction)
        assertEquals("connected", correction.readerConnection)
        assertTrue(correction.cancelStaleCancelable)
    }

    @Test fun localActiveRequestClearsWhenServerActiveRequestIsNull() {
        val correction = BridgeStatePolicy.correction(
            LocalBridgeSnapshot("req_1", "connected", ReaderActionState.COLLECTING, hasPaymentCancelable = false, busy = true),
            ServerBridgeSnapshot(null, "connected", ReaderActionState.IDLE, null)
        )
        assertNotNull(correction)
        assertTrue(correction!!.clearActiveRequest)
        assertTrue(correction.clearBusy)
    }

    @Test fun failedServerRequestCannotRemainLocallyActive() {
        val correction = BridgeStatePolicy.correction(
            LocalBridgeSnapshot("req_1", "connected", ReaderActionState.PROCESSING, hasPaymentCancelable = true, busy = true),
            ServerBridgeSnapshot(null, "connected", ReaderActionState.IDLE, "failed")
        )
        assertNotNull(correction)
        assertEquals(ReaderActionState.CANCELLING, correction!!.readerAction)
        assertTrue(correction.movePaymentToHistory)
    }

    @Test fun alreadyIdleStateNeedsNoCorrection() {
        val correction = BridgeStatePolicy.correction(
            LocalBridgeSnapshot(null, "connected", ReaderActionState.IDLE, hasPaymentCancelable = false, busy = false),
            ServerBridgeSnapshot(null, "connected", ReaderActionState.IDLE, null)
        )
        assertNull(correction)
    }

    @Test fun activeServerStateDoesNotClearLocalWork() {
        val correction = BridgeStatePolicy.correction(
            LocalBridgeSnapshot("req_1", "connected", ReaderActionState.PROCESSING, hasPaymentCancelable = true, busy = true),
            ServerBridgeSnapshot("req_1", "connected", ReaderActionState.PROCESSING, "processing")
        )
        assertNull(correction)
    }
}
