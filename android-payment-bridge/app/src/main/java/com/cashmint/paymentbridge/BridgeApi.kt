package com.cashmint.paymentbridge

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** All amounts stay server-side. This client can only claim and process a request ID. */
class BridgeApi(
    private val baseUrl: String,
    private val anonKey: String,
    private val accessToken: () -> String,
    private val realtimeKey: () -> String = { anonKey },
) {
    private val http = OkHttpClient.Builder()
        .callTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private fun request(path: String, body: JSONObject = JSONObject(), authenticated: Boolean = true): Request {
        val builder = Request.Builder()
        .url("$baseUrl/functions/v1/$path")
        .header("apikey", anonKey)
        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        if (authenticated) builder.header("Authorization", "Bearer ${accessToken()}")
        return builder.build()
    }
    fun connectionToken(done: (Result<String>) -> Unit) = call("terminal-connection-token", JSONObject(), done) { it.getString("secret") }
    fun createIntent(id: String, done: (Result<IntentPayload>) -> Unit) = call("create-terminal-payment-intent", JSONObject().put("payment_request_id", id), done) { IntentPayload(it.getString("id"), it.getString("client_secret")) }
    fun status(id: String, done: (Result<JSONObject>) -> Unit) = call("retrieve-terminal-payment-status", JSONObject().put("payment_request_id", id), done) { it }
    fun enroll(code: String, displayName: String, done: (Result<JSONObject>) -> Unit) = call("register-terminal-device", JSONObject().put("enrollment_code", code).put("display_name", displayName), done, authenticated = false) { it }
    fun cancelPayment(id: String, done: (Result<JSONObject>) -> Unit) = call("cancel-terminal-payment", JSONObject().put("payment_request_id", id), done) { it }
    fun function(path: String, body: JSONObject, done: (Result<JSONObject>) -> Unit) = call(path, body, done) { it }
    fun fetchRealtimeKey(done: (Result<String>) -> Unit) = call("terminal-realtime-key", JSONObject(), done) { it.getString("realtime_key") }
    fun terminalDevice(deviceId: String, done: (Result<JSONObject>) -> Unit) {
        val request = Request.Builder()
            .url("$baseUrl/rest/v1/terminal_devices?select=id,reader_status,reader_action_status,current_payment_request_id,app_version,last_heartbeat_at,cleanup_completed_at&id=eq.$deviceId&limit=1")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer ${accessToken()}")
            .get()
            .build()
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = done(Result.failure(e))
            override fun onResponse(call: Call, response: Response) { response.use { r ->
                try {
                    val raw = r.body?.string().orEmpty()
                    if (!r.isSuccessful) { done(Result.failure(IOException(safeError(raw, r.code)))); return }
                    val array = org.json.JSONArray(raw)
                    done(Result.success(if (array.length() > 0) array.getJSONObject(0) else JSONObject()))
                } catch (e: Exception) {
                    done(Result.failure(e))
                }
            } }
        })
    }
    fun refreshSession(refreshToken: String, done: (Result<JSONObject>) -> Unit) {
        val body = JSONObject().put("refresh_token", refreshToken).toString()
        val request = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=refresh_token")
            .header("apikey", anonKey)
            .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = done(Result.failure(IOException("Network error: ${e.message}", e)))
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
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).also {
            it.timeZone = TimeZone.getTimeZone("UTC")
        }
        val now = URLEncoder.encode(formatter.format(Date()), "UTF-8")
        val request = Request.Builder().url("$baseUrl/rest/v1/payment_requests?select=id,status,stripe_payment_intent_id,expires_at&location_id=eq.$locationId&status=in.(pending,claimed,creating_payment_intent,waiting_for_card,processing,cancel_requested,unknown)&expires_at=gt.$now&order=created_at.asc&limit=1").header("apikey", anonKey).header("Authorization", "Bearer ${accessToken()}").get().build()
        http.newCall(request).enqueue(object: Callback { override fun onFailure(call: Call,e:IOException)=done(Result.failure(e)); override fun onResponse(call:Call,response:Response){response.use { r -> try { val raw = r.body?.string().orEmpty(); if (!r.isSuccessful) { done(Result.failure(IOException(safeError(raw, r.code)))); return } val a=org.json.JSONArray(raw); done(Result.success((0 until a.length()).map{a.getJSONObject(it)})) } catch(e:Exception){done(Result.failure(e))} } } })
    }
    fun realtimeSocket(): WebSocket {
        val realtimeUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://")
        val key = URLEncoder.encode(realtimeKey(), "UTF-8")
        val request = Request.Builder()
            .url("$realtimeUrl/realtime/v1/websocket?apikey=$key&vsn=1.0.0")
            .build()
        return http.newWebSocket(request, object : WebSocketListener() {})
    }
    fun openRealtime(listener: WebSocketListener): WebSocket {
        val realtimeUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://")
        val key = URLEncoder.encode(realtimeKey(), "UTF-8")
        val request = Request.Builder()
            .url("$realtimeUrl/realtime/v1/websocket?apikey=$key&vsn=1.0.0")
            .build()
        return http.newWebSocket(request, listener)
    }
    private fun safeError(raw: String, status: Int): String = try {
        val value = JSONObject(raw)
        val code = value.optString("code").takeIf { it.isNotBlank() }
        val error = value.optString("error").takeIf { it.isNotBlank() }
            ?: value.optString("message").takeIf { it.isNotBlank() }
            ?: "Request failed"
        val details = value.optString("details").takeIf { it.isNotBlank() }
        listOfNotNull("HTTP $status", code, error, details).joinToString(": ")
    } catch (_: Exception) { "HTTP $status: Request failed" }

    private fun <T> call(path: String, body: JSONObject, done: (Result<T>) -> Unit, authenticated: Boolean = true, map: (JSONObject) -> T) {
        http.newCall(request(path, body, authenticated)).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = done(Result.failure(IOException("Network error: ${e.message}", e)))
            override fun onResponse(call: Call, response: Response) { response.use { r ->
                val raw = r.body?.string().orEmpty()
                if (!r.isSuccessful) { done(Result.failure(IOException(safeError(raw, r.code)))); return }
                try { done(Result.success(map(JSONObject(raw)))) } catch (e: Exception) { done(Result.failure(e)) }
            }}
        })
    }
}
data class IntentPayload(val id: String, val clientSecret: String)
