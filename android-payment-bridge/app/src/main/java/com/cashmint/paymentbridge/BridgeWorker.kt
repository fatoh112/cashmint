package com.cashmint.paymentbridge

import android.content.Context
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Serializes bridge work. The server is authoritative for amounts and completion. */
object BridgeWorker {
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val busy = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    private lateinit var api: BridgeApi
    private lateinit var credentials: BridgeCredentials
    private var readerStatus = "disconnected"
    private var realtime: WebSocket? = null
    private var loop: ScheduledFuture<*>? = null
    private var lastRealtimeAt = 0L
    private var reconnectAfter = 0L
    private var lastHeartbeat = "Never"
    private var lastError = ""
    private var onClaimed: ((String) -> Unit)? = null
    private var onCancel: ((String) -> Unit)? = null
    private var retryingActiveRequestId = ""
    private var retryingActiveAt = 0L

    fun start(context: Context, client: BridgeApi, claimed: (String) -> Unit, cancelled: (String) -> Unit = {}) {
        credentials = BridgeCredentials(context.applicationContext)
        api = client
        onClaimed = claimed
        onCancel = cancelled
        if (!credentials.enrolled()) return
        if (started.compareAndSet(false, true)) {
            // Never let an unexpected bridge/network exception stop the periodic
            // executor. ScheduledExecutorService otherwise silently cancels all
            // future runs after one uncaught exception.
            loop = executor.scheduleAtFixedRate({
                runCatching { tick() }
                    .onFailure { lastError = "Bridge loop failed: ${it.message ?: it.javaClass.simpleName}" }
            }, 0, 20, TimeUnit.SECONDS)
        }
    }

    fun stop() {
        started.set(false)
        loop?.cancel(true)
        loop = null
        realtime?.close(1000, "bridge stopped")
        realtime = null
        busy.set(false)
        credentials.setActiveRequestId(null)
    }

    private fun tick() {
        if (!started.get() || !credentials.enrolled()) return
        refreshThen {
            heartbeat()
            ensureRealtime()
            reconcile()
        }
    }

    private fun refreshThen(next: () -> Unit) {
        if (!credentials.tokenExpiresSoon()) { next(); return }
        val refresh = credentials.refreshToken()
        if (refresh.isBlank()) { lastError = "Session refresh token is missing"; return }
        api.refreshSession(refresh) { result ->
            result.onSuccess { credentials.saveSession(it); next() }
                .onFailure { lastError = "Session refresh failed: ${it.message}" }
        }
    }

    private fun heartbeat() {
        api.rpc("bridge_heartbeat", JSONObject()
            .put("p_reader_status", readerStatus)
            .put("p_current_payment_request_id", credentials.activeRequestId().ifBlank { JSONObject.NULL })
            .put("p_app_version", "1.0.11")) { result ->
            result.onSuccess { lastHeartbeat = java.text.DateFormat.getTimeInstance().format(java.util.Date()) }
                .onFailure { lastError = "Heartbeat failed: ${it.message}" }
        }
    }

    private fun reconcile() {
        val active = credentials.activeRequestId()
        if (active.isNotBlank()) {
            api.status(active) { result -> result.onSuccess { request ->
                when (request.optString("status")) {
                    "cancel_requested" -> onCancel?.invoke(active)
                    "requires_payment_method", "succeeded", "failed", "cancelled", "expired" -> release(active)
                }
            }.onFailure { lastError = "Active payment reconciliation failed: ${it.message}" } }
            return
        }
        if (busy.get()) return
        api.pending(credentials.locationId) { result ->
            result.onSuccess { it.firstOrNull()?.let(::handleCandidate) }
                .onFailure { lastError = "REST reconciliation failed: ${it.message}" }
        }
    }

    private fun handleCandidate(request: JSONObject) {
        val id = request.optString("id")
        if (id.isBlank()) return
        when (request.optString("status")) {
            "cancel_requested" -> onCancel?.invoke(id)
            "pending" -> if (busy.compareAndSet(false, true)) {
                api.rpc("claim_terminal_payment_request", JSONObject().put("p_payment_request_id", id)) { result ->
                    result.onSuccess {
                        retryingActiveRequestId = ""
                        retryingActiveAt = 0L
                        credentials.setActiveRequestId(id)
                        onClaimed?.invoke(id)
                    }.onFailure { busy.set(false); lastError = "Payment claim failed: ${it.message}" }
                }
            }
            "claimed", "creating_payment_intent" -> if (busy.compareAndSet(false, true)) {
                credentials.setActiveRequestId(id)
                onClaimed?.invoke(id)
            }
            "waiting_for_card", "processing", "unknown", "requires_payment_method", "failed", "cancelled", "expired", "succeeded" -> release(id)
        }
    }

    private fun ensureRealtime() {
        val now = System.currentTimeMillis()
        if (realtime != null && now - lastRealtimeAt < 60_000L) return
        if (now < reconnectAfter) return
        realtime?.cancel()
        realtime = api.openRealtime(object : WebSocketListener() {
            override fun onOpen(socket: WebSocket, response: Response) {
                lastRealtimeAt = System.currentTimeMillis()
                reconnectAfter = 0L
                socket.send(JSONObject().put("topic", "realtime:public:payment_requests").put("event", "phx_join").put("ref", "1")
                    .put("payload", JSONObject().put("config", JSONObject().put("postgres_changes", JSONArray().put(
                        JSONObject().put("event", "*").put("schema", "public").put("table", "payment_requests")
                            .put("filter", "location_id=eq.${credentials.locationId}")
                    )))).toString())
            }
            override fun onMessage(socket: WebSocket, text: String) {
                lastRealtimeAt = System.currentTimeMillis()
                val root = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (root.optString("event") == "phx_reply") return
                val payload = root.optJSONObject("payload") ?: return
                val record = payload.optJSONObject("data")?.optJSONObject("record") ?: payload.optJSONObject("record") ?: return
                handleCandidate(record)
            }
            override fun onFailure(socket: WebSocket, t: Throwable, response: Response?) { disconnected("Realtime failed: ${t.message}") }
            override fun onClosed(socket: WebSocket, code: Int, reason: String) { disconnected("Realtime closed: $reason") }
        })
    }

    private fun disconnected(message: String) {
        realtime = null
        lastError = message
        reconnectAfter = System.currentTimeMillis() + 5_000L
    }

    fun readerConnected() {
        readerStatus = "connected"
        // Do not wait for the next scheduled tick: card payment availability must
        // change as soon as Stripe confirms that the local reader is connected.
        if (started.get() && ::api.isInitialized && ::credentials.isInitialized && credentials.enrolled()) heartbeat()
    }
    fun readerDisconnected() { readerStatus = "disconnected" }
    fun diagnostics() = "Heartbeat: $lastHeartbeat\nBackend: ${lastError.ifBlank { "OK" }}\nReader: $readerStatus"
    fun clearDiagnostics() { lastError = ""; lastHeartbeat = "Never" }
    fun markWaiting(id: String) = update(id, "waiting_for_card")
    fun markProcessing(id: String) = update(id, "processing")
    fun markUnknownUntilWebhook(id: String) = update(id, "unknown")
    fun markFailureOrUnknown(id: String, error: Throwable) = update(id, "unknown", error.message)
    fun markFailed(id: String, message: String) = update(id, "failed", message)
    fun markCancelled(id: String) = update(id, "cancelled")
    fun release(id: String) {
        if (credentials.activeRequestId() == id) credentials.setActiveRequestId(null)
        retryingActiveRequestId = ""
        retryingActiveAt = 0L
        busy.set(false)
    }
    private fun update(id: String, status: String, error: String? = null) {
        api.rpc("bridge_update_terminal_payment", JSONObject().put("p_payment_request_id", id).put("p_status", status).put("p_failure_message", error)) { result ->
            result.onFailure { lastError = "Payment status update failed: ${it.message}" }
            if (status in setOf("succeeded", "failed", "cancelled", "expired")) release(id)
        }
    }
}
