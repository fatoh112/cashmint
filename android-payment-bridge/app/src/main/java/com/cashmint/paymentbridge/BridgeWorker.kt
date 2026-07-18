package com.cashmint.paymentbridge

import android.content.Context
import com.stripe.stripeterminal.external.models.TerminalException
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * Lifecycle boundary for the foreground bridge service. Its production adapter
 * subscribes to payment_requests through Supabase Realtime, invokes
 * claim_terminal_payment_request before calling the supplied callback, and
 * serializes work with a mutex. Keeping that transport here ensures the payment
 * screen can never create orders or accept a manually entered amount.
 */
object BridgeWorker {
    private val executor = Executors.newSingleThreadScheduledExecutor(); private val busy=AtomicBoolean(false); private val started=AtomicBoolean(false)
    private lateinit var api: BridgeApi; private lateinit var credentials: BridgeCredentials; private var readerStatus="disconnected"
    private var realtime: WebSocket? = null; private var onClaimedPaymentRequest: ((String) -> Unit)? = null; private var onCancelRequested: ((String) -> Unit)? = null; private var lastRealtimeAt = 0L; private var loop: ScheduledFuture<*>? = null
    fun start(context: Context, client: BridgeApi, onClaimed: (String) -> Unit, onCancel: (String) -> Unit = {}) {
        credentials=BridgeCredentials(context); api=client; onClaimedPaymentRequest=onClaimed; onCancelRequested=onCancel; if(!credentials.enrolled()) return
        connectRealtime()
        if (started.compareAndSet(false, true)) loop = executor.scheduleAtFixedRate({ refreshTokenIfNeeded(); heartbeat(); reconcile(onClaimed) },0,20,TimeUnit.SECONDS)
    }
    fun stop(){ realtime?.close(1000, "stopped"); loop?.cancel(false); loop = null; realtime = null; busy.set(false); started.set(false) }
    private fun refreshTokenIfNeeded() {
        if (!credentials.tokenExpiresSoon() || credentials.refreshToken().isBlank()) return
        api.refreshSession(credentials.refreshToken()) { it.onSuccess(credentials::saveSession) }
    }
    private fun heartbeat(){ api.rpc("bridge_heartbeat", JSONObject().put("p_reader_status",readerStatus).put("p_current_payment_request_id",credentials.activeRequestId().ifBlank { JSONObject.NULL }).put("p_app_version","1.0.0")){} }
    private fun reconcile(onClaimed:(String)->Unit){
        if (System.currentTimeMillis() - lastRealtimeAt > 60_000L && realtime == null) connectRealtime()
        if(busy.get()) return
        api.pending(credentials.locationId){ result -> result.getOrNull()?.firstOrNull()?.let { request -> handleCandidate(request, onClaimed) } }
    }
    private fun handleCandidate(request: JSONObject, onClaimed:(String)->Unit) {
        val id = request.getString("id")
        val status = request.optString("status")
        if (status == "cancel_requested") { onCancelRequested?.invoke(id); return }
        if (!listOf("pending", "claimed", "creating_payment_intent", "waiting_for_card", "processing", "unknown").contains(status)) return
        if(busy.compareAndSet(false,true)){
            if (status == "pending") {
                api.rpc("claim_terminal_payment_request",JSONObject().put("p_payment_request_id",id)){ claimed -> if(claimed.isSuccess){ credentials.setActiveRequestId(id); onClaimed(id) } else busy.set(false) }
            } else {
                credentials.setActiveRequestId(id); onClaimed(id)
            }
        }
    }
    private fun connectRealtime() {
        realtime?.close(1000, "reconnect")
        realtime = api.openRealtime(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                lastRealtimeAt = System.currentTimeMillis()
                val payload = JSONObject()
                    .put("topic", "realtime:public:payment_requests")
                    .put("event", "phx_join")
                    .put("ref", "join")
                    .put("payload", JSONObject()
                        .put("config", JSONObject()
                            .put("postgres_changes", org.json.JSONArray()
                                .put(JSONObject().put("event", "*").put("schema", "public").put("table", "payment_requests").put("filter", "location_id=eq.${credentials.locationId}")))))
                webSocket.send(payload.toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                lastRealtimeAt = System.currentTimeMillis()
                val root = runCatching { JSONObject(text) }.getOrNull() ?: return
                val payload = root.optJSONObject("payload") ?: return
                val data = payload.optJSONObject("data")?.optJSONObject("record") ?: payload.optJSONObject("record") ?: return
                onClaimedPaymentRequest?.let { handleCandidate(data, it) }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                realtime = null
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                realtime = null
            }
        })
    }
    fun readerConnected(){ readerStatus="connected" }; fun readerDisconnected(){ readerStatus="disconnected" }
    fun markProcessing(requestId:String){ update(requestId,"processing") }
    fun markWaiting(requestId:String){ update(requestId,"waiting_for_card") }
    fun markUnknownUntilWebhook(requestId:String){ update(requestId,"unknown"); busy.set(false); credentials.setActiveRequestId(null) }
    fun markFailureOrUnknown(requestId:String,error:Throwable){ update(requestId,"unknown",error.message); busy.set(false); credentials.setActiveRequestId(null) }
    fun markCancelled(requestId:String){ update(requestId,"cancelled"); busy.set(false); credentials.setActiveRequestId(null) }
    private fun update(id:String,status:String,error:String?=null){ api.rpc("bridge_update_terminal_payment",JSONObject().put("p_payment_request_id",id).put("p_status",status).put("p_failure_message",error)){} }
}
