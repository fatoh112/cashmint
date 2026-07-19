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
    private var realtimeConnecting = false
    private var lastHeartbeat = "Never"
    private var lastError = ""
    private var readerActionStatus = ReaderActionState.IDLE
    private var realtimeStatus = "disconnected"
    private var tokenDiagnostics = "Token source: missing\nJWT format valid: no\nJWT expiry: unknown\nRefresh succeeded: no"
    private var realtimeRef = 1
    private var realtimeKeyFetchInFlight = false
    private var lastRealtimeKeyFetchAt = 0L
    private var onClaimed: ((String) -> Unit)? = null
    private var onCancel: ((String) -> Unit)? = null
    private var onServerIdle: (() -> Unit)? = null
    private var hasActiveSdkOperation: (() -> Boolean)? = null

    fun start(context: Context, client: BridgeApi, claimed: (String) -> Unit, cancelled: (String) -> Unit = {}, serverIdle: () -> Unit = {}, sdkBusy: () -> Boolean = { false }) {
        credentials = BridgeCredentials(context.applicationContext)
        api = client
        onClaimed = claimed
        onCancel = cancelled
        onServerIdle = serverIdle
        hasActiveSdkOperation = sdkBusy
        if (!credentials.enrolled()) return
        if (RealtimeRuntimePolicy.shouldStartPollingLoop(started.get()) && started.compareAndSet(false, true)) {
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
        realtimeStatus = "disconnected"
        busy.set(false)
        credentials.setActiveRequestId(null)
    }

    private fun tick() {
        if (!started.get() || !credentials.enrolled()) return
        refreshThen {
            heartbeat()
            sendRealtimeHeartbeat()
            ensureRealtime()
            syncServerDeviceState()
            reconcile()
        }
    }

    private fun refreshThen(next: () -> Unit) {
        if (!credentials.tokenExpiresSoon()) { next(); return }
        val refresh = credentials.refreshToken()
        if (refresh.isBlank()) { lastError = "Session refresh token is missing"; return }
        api.refreshSession(refresh) { result ->
            result.onSuccess {
                credentials.saveSession(it)
                updateTokenDiagnostics(true)
                realtime?.close(1000, "token refreshed")
                realtime = null
                realtimeConnecting = false
                next()
            }
                .onFailure {
                    updateTokenDiagnostics(false)
                    lastError = "Session refresh failed: ${it.message}"
                }
        }
    }

    private fun heartbeat() {
        api.rpc("bridge_heartbeat", JSONObject()
            .put("p_reader_status", readerStatus)
            .put("p_reader_action_status", readerActionStatus.name.lowercase())
            .put("p_current_payment_request_id", credentials.activeRequestId().ifBlank { JSONObject.NULL })
            .put("p_app_version", "1.0.16")) { result ->
            result.onSuccess { lastHeartbeat = java.text.DateFormat.getTimeInstance().format(java.util.Date()) }
                .onFailure { lastError = "Heartbeat failed: ${it.message}" }
        }
    }

    private fun syncServerDeviceState(done: (() -> Unit)? = null) {
        if (!::api.isInitialized || !::credentials.isInitialized || credentials.deviceId.isBlank()) {
            done?.invoke()
            return
        }
        api.terminalDevice(credentials.deviceId) { result ->
            result.onSuccess { device ->
                val serverAction = runCatching { ReaderActionState.valueOf(device.optString("reader_action_status", "idle").uppercase()) }
                    .getOrDefault(ReaderActionState.IDLE)
                val serverReader = device.optString("reader_status", readerStatus).ifBlank { readerStatus }
                val serverActive = if (device.isNull("current_payment_request_id")) null else device.optString("current_payment_request_id").ifBlank { null }
                val local = LocalBridgeSnapshot(credentials.activeRequestId().ifBlank { null }, readerStatus, readerActionStatus, hasActiveSdkOperation?.invoke() == true, busy.get())
                val server = ServerBridgeSnapshot(serverActive, serverReader, serverAction, null)
                BridgeStatePolicy.correction(local, server)?.let {
                    credentials.setActiveRequestId(null)
                    busy.set(false)
                    readerStatus = it.readerConnection
                    readerActionStatus = it.readerAction
                    onServerIdle?.invoke()
                } ?: run {
                    readerStatus = serverReader
                    if (serverActive == null && serverAction == ReaderActionState.IDLE && local.hasPaymentCancelable) {
                        onServerIdle?.invoke()
                    } else {
                        readerActionStatus = serverAction
                        if (serverActive == null && serverAction == ReaderActionState.IDLE) onServerIdle?.invoke()
                    }
                }
            }.onFailure { lastError = "Server state sync failed: ${it.message}" }
            done?.invoke()
        }
    }

    private fun reconcile() {
        val active = credentials.activeRequestId()
        if (active.isNotBlank()) {
            api.status(active) { result -> result.onSuccess { request ->
                when (request.optString("status")) {
                    "cancel_requested" -> onCancel?.invoke(active)
                    "succeeded", "failed", "cancelled", "expired" -> release(active)
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
                        credentials.setActiveRequestId(id)
                        onClaimed?.invoke(id)
                    }.onFailure { busy.set(false); lastError = "Payment claim failed: ${it.message}" }
                }
            }
            "claimed", "creating_payment_intent", "waiting_for_card", "processing", "unknown" -> if (busy.compareAndSet(false, true)) {
                credentials.setActiveRequestId(id)
                onClaimed?.invoke(id)
            }
            "failed", "cancelled", "expired", "succeeded" -> release(id)
        }
    }

    private fun ensureRealtime() {
        val now = System.currentTimeMillis()
        val validation = updateTokenDiagnostics(false)
        val key = credentials.realtimeKey().ifBlank { credentials.anonKey }
        if (!RealtimeAuth.isRealtimeApiKeyCompatible(key)) {
            fetchRealtimeKeyIfNeeded(now)
            disconnected("Realtime API key incompatible: fetching Realtime key")
            return
        }
        if (!RealtimeRuntimePolicy.shouldOpenSocket(realtimeConnecting, realtime != null, lastRealtimeAt, reconnectAfter, now, validation.valid)) {
            if (!validation.valid) disconnected("Realtime token invalid: ${validation.reason}")
            return
        }
        if (!validation.valid) {
            disconnected("Realtime token invalid: ${validation.reason}")
            return
        }
        realtime?.cancel()
        realtimeConnecting = true
        realtimeStatus = "connecting"
        realtime = api.openRealtime(object : WebSocketListener() {
            override fun onOpen(socket: WebSocket, response: Response) {
                lastRealtimeAt = System.currentTimeMillis()
                reconnectAfter = 0L
                realtimeConnecting = false
                realtimeStatus = "joining"
                realtimeRef = 1
                val token = credentials.accessToken().trim()
                socket.send(JSONObject().put("topic", "realtime:public:payment_requests").put("event", "phx_join").put("ref", "1").put("join_ref", "1")
                    .put("payload", JSONObject()
                        .put("access_token", token)
                        .put("config", JSONObject().put("postgres_changes", JSONArray().put(
                            JSONObject().put("event", "*").put("schema", "public").put("table", "payment_requests")
                                .put("filter", "location_id=eq.${credentials.locationId}")
                        )))).toString())
                syncServerDeviceState()
            }
            override fun onMessage(socket: WebSocket, text: String) {
                lastRealtimeAt = System.currentTimeMillis()
                val root = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (root.optString("event") == "phx_reply") {
                    val payload = root.optJSONObject("payload")
                    when (payload?.optString("status")) {
                        "ok" -> {
                            realtimeStatus = "connected"
                            lastError = ""
                        }
                        "error" -> if (realtime == socket) {
                            disconnected("Realtime join failed: ${payload.optJSONObject("response")?.optString("reason", "unknown") ?: "unknown"}")
                        }
                    }
                    return
                }
                val payload = root.optJSONObject("payload") ?: return
                val record = payload.optJSONObject("data")?.optJSONObject("record") ?: payload.optJSONObject("record") ?: return
                handleCandidate(record)
            }
            override fun onFailure(socket: WebSocket, t: Throwable, response: Response?) {
                if (realtime == socket) disconnected("Realtime failed: ${response?.code ?: ""} ${t.message}".trim())
            }
            override fun onClosed(socket: WebSocket, code: Int, reason: String) {
                if (realtime == socket) disconnected("Realtime closed: $reason")
            }
        })
    }

    private fun fetchRealtimeKeyIfNeeded(now: Long) {
        if (realtimeKeyFetchInFlight || now - lastRealtimeKeyFetchAt < 60_000L) return
        realtimeKeyFetchInFlight = true
        lastRealtimeKeyFetchAt = now
        realtimeStatus = "fetching key"
        api.fetchRealtimeKey { result ->
            realtimeKeyFetchInFlight = false
            result.onSuccess { key ->
                credentials.saveRealtimeKey(key)
                if (RealtimeAuth.isRealtimeApiKeyCompatible(key)) {
                    lastError = ""
                    reconnectAfter = 0L
                } else {
                    lastError = "Realtime key endpoint returned incompatible key"
                }
            }.onFailure {
                lastError = "Realtime key fetch failed: ${it.message}"
            }
        }
    }

    private fun sendRealtimeHeartbeat() {
        val socket = realtime ?: return
        val ref = (++realtimeRef).toString()
        socket.send(JSONObject().put("topic", "phoenix").put("event", "heartbeat").put("payload", JSONObject()).put("ref", ref).toString())
    }

    private fun disconnected(message: String) {
        realtime = null
        realtimeConnecting = false
        realtimeStatus = "disconnected"
        lastError = message
        reconnectAfter = System.currentTimeMillis() + 5_000L
    }

    private fun updateTokenDiagnostics(refreshSucceeded: Boolean): RealtimeTokenValidation {
        val validation = RealtimeAuth.validateSessionAccessToken(credentials.accessToken(), credentials.anonKey, credentials.refreshToken())
        tokenDiagnostics = "Token source: ${validation.source}\nJWT format valid: ${if (validation.jwtFormatValid) "yes" else "no"}\nJWT expiry: ${validation.expiryDisplay}\nRefresh succeeded: ${if (refreshSucceeded) "yes" else "no"}"
        return validation
    }

    fun readerConnected() {
        readerStatus = "connected"
        // Do not wait for the next scheduled tick: card payment availability must
        // change as soon as Stripe confirms that the local reader is connected.
        if (started.get() && ::api.isInitialized && ::credentials.isInitialized && credentials.enrolled()) heartbeat()
    }
    fun readerDisconnected() { readerStatus = "disconnected"; readerActionStatus = ReaderActionState.IDLE }
    fun setReaderAction(state: ReaderActionState) {
        readerActionStatus = state
        if (started.get() && ::api.isInitialized && ::credentials.isInitialized && credentials.enrolled()) heartbeat()
    }
    fun requestServerSync() = syncServerDeviceState()
    fun diagnostics() = "Heartbeat: $lastHeartbeat\nBackend: ${lastError.ifBlank { "OK" }}\nRealtime: $realtimeStatus\nReader: $readerStatus\nReader action: ${readerActionStatus.name.lowercase()}\n$tokenDiagnostics"
    fun clearDiagnostics() { lastError = ""; lastHeartbeat = "Never" }
    fun markWaiting(id: String) = update(id, "waiting_for_card")
    fun markProcessing(id: String) = update(id, "processing")
    fun markUnknownUntilWebhook(id: String) = update(id, "unknown")
    fun markFailureOrUnknown(id: String, error: Throwable) = update(id, "unknown", error.message)
    fun markFailed(id: String, message: String) = update(id, "failed", message)
    fun markCancelled(id: String) = update(id, "cancelled")
    fun release(id: String) {
        if (credentials.activeRequestId() == id) credentials.setActiveRequestId(null)
        readerActionStatus = ReaderActionState.IDLE
        busy.set(false)
        heartbeat()
    }
    private fun update(id: String, status: String, error: String? = null) {
        api.rpc("bridge_update_terminal_payment", JSONObject().put("p_payment_request_id", id).put("p_status", status).put("p_failure_message", error)) { result ->
            result.onFailure { lastError = "Payment status update failed: ${it.message}" }
            if (status in setOf("succeeded", "failed", "cancelled", "expired")) release(id)
        }
    }
}
