package com.cashmint.paymentbridge

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

/** All amounts stay server-side. This client can only claim and process a request ID. */
class BridgeApi(private val baseUrl: String, private val anonKey: String, private val accessToken: () -> String) {
    private val http = OkHttpClient()
    private fun request(path: String, body: JSONObject = JSONObject()): Request = Request.Builder()
        .url("$baseUrl/functions/v1/$path")
        .header("apikey", anonKey).header("Authorization", "Bearer ${accessToken()}")
        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
    fun connectionToken(done: (Result<String>) -> Unit) = call("terminal-connection-token", JSONObject(), done) { it.getString("secret") }
    fun createIntent(id: String, done: (Result<IntentPayload>) -> Unit) = call("create-terminal-payment-intent", JSONObject().put("payment_request_id", id), done) { IntentPayload(it.getString("id"), it.getString("client_secret")) }
    fun status(id: String, done: (Result<JSONObject>) -> Unit) = call("retrieve-terminal-payment-status", JSONObject().put("payment_request_id", id), done) { it }
    fun enroll(code: String, displayName: String, done: (Result<JSONObject>) -> Unit) = call("register-terminal-device", JSONObject().put("enrollment_code", code).put("display_name", displayName), done) { it }
    fun cancelPayment(id: String, done: (Result<JSONObject>) -> Unit) = call("cancel-terminal-payment", JSONObject().put("payment_request_id", id), done) { it }
    fun function(path: String, body: JSONObject, done: (Result<JSONObject>) -> Unit) = call(path, body, done) { it }
    fun refreshSession(refreshToken: String, done: (Result<JSONObject>) -> Unit) {
        val body = JSONObject().put("refresh_token", refreshToken).toString()
        val request = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=refresh_token")
            .header("apikey", anonKey)
            .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = done(Result.failure(e))
            override fun onResponse(call: Call, response: Response) { response.use { r ->
                try {
                    val value = JSONObject(r.body?.string().orEmpty())
                    if (!r.isSuccessful) error(value.optString("msg", value.optString("error_description", "Token refresh failed")))
                    done(Result.success(value))
                } catch (e: Exception) {
                    done(Result.failure(e))
                }
            } }
        })
    }
    fun rpc(name: String, body: JSONObject, done: (Result<JSONObject>) -> Unit) {
        val request = Request.Builder().url("$baseUrl/rest/v1/rpc/$name").header("apikey", anonKey).header("Authorization", "Bearer ${accessToken()}").post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        http.newCall(request).enqueue(object : Callback { override fun onFailure(call: Call, e: IOException) = done(Result.failure(e)); override fun onResponse(call: Call, response: Response) { response.use { r -> try { val raw = r.body?.string().orEmpty(); val value=if (raw.trim().startsWith("[")) org.json.JSONArray(raw).getJSONObject(0) else JSONObject(raw); if(!r.isSuccessful) error(value.optString("message", "RPC failed")); done(Result.success(value)) } catch(e:Exception){done(Result.failure(e))} } } })
    }
    fun pending(locationId: String, done: (Result<List<JSONObject>>) -> Unit) {
        val request = Request.Builder().url("$baseUrl/rest/v1/payment_requests?select=id,status,stripe_payment_intent_id&location_id=eq.$locationId&status=in.(pending,claimed,creating_payment_intent,waiting_for_card,processing,unknown,cancel_requested)&order=created_at.asc&limit=1").header("apikey", anonKey).header("Authorization", "Bearer ${accessToken()}").get().build()
        http.newCall(request).enqueue(object: Callback { override fun onFailure(call: Call,e:IOException)=done(Result.failure(e)); override fun onResponse(call:Call,response:Response){response.use { r -> try { val a=org.json.JSONArray(r.body!!.string()); done(Result.success((0 until a.length()).map{a.getJSONObject(it)})) } catch(e:Exception){done(Result.failure(e))} } } })
    }
    fun realtimeSocket(): WebSocket {
        val realtimeUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://")
        val request = Request.Builder()
            .url("$realtimeUrl/realtime/v1/websocket?apikey=$anonKey&vsn=1.0.0")
            .header("Authorization", "Bearer ${accessToken()}")
            .build()
        return http.newWebSocket(request, object : WebSocketListener() {})
    }
    fun openRealtime(listener: WebSocketListener): WebSocket {
        val realtimeUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://")
        val request = Request.Builder()
            .url("$realtimeUrl/realtime/v1/websocket?apikey=$anonKey&vsn=1.0.0")
            .header("Authorization", "Bearer ${accessToken()}")
            .build()
        return http.newWebSocket(request, listener)
    }
    private fun <T> call(path: String, body: JSONObject, done: (Result<T>) -> Unit, map: (JSONObject) -> T) {
        http.newCall(request(path, body)).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = done(Result.failure(e))
            override fun onResponse(call: Call, response: Response) { response.use { r ->
                try { val value = JSONObject(r.body!!.string()); if (!r.isSuccessful) error(value.optString("error", "Request failed")); done(Result.success(map(value))) } catch (e: Exception) { done(Result.failure(e)) }
            }}
        })
    }
}
data class IntentPayload(val id: String, val clientSecret: String)
