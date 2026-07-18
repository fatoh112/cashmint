package com.cashmint.paymentbridge

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Callback
import com.stripe.stripeterminal.external.callable.Cancelable
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider
import com.stripe.stripeterminal.external.callable.DiscoveryListener
import com.stripe.stripeterminal.external.callable.MobileReaderListener
import com.stripe.stripeterminal.external.callable.OfflineListener
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.CollectPaymentIntentConfiguration
import com.stripe.stripeterminal.external.models.ConfirmPaymentIntentConfiguration
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.CustomerCancellation
import com.stripe.stripeterminal.external.models.DisconnectReason
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.OfflineStatus
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.TerminalException
import com.stripe.stripeterminal.log.LogLevel

class MainActivity : AppCompatActivity(), TerminalListener {
    private lateinit var credentials: BridgeCredentials
    private lateinit var api: BridgeApi
    private lateinit var status: TextView
    private lateinit var supabaseUrlInput: EditText
    private lateinit var anonKeyInput: EditText
    private lateinit var enrollmentCodeInput: EditText
    private lateinit var displayNameInput: EditText
    private lateinit var simulatedSwitch: Switch
    private lateinit var enrollButton: Button
    private lateinit var resetButton: Button
    private lateinit var cancelButton: Button
    private var discoveryCancelable: Cancelable? = null
    private var paymentCancelable: Cancelable? = null
    private var activeRequestId: String? = null

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        initializeTerminal()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        credentials = BridgeCredentials(this)
        api = BridgeApi(credentials.supabaseUrl, credentials.anonKey) { credentials.accessToken() }
        if (credentials.enrolled()) requestPermissionsIfNeeded() else showEnrollment()
    }

    private fun buildUi() {
        val root = LinearLayout(this).also {
            it.orientation = LinearLayout.VERTICAL
            it.setPadding(32, 32, 32, 32)
        }
        status = TextView(this).also { it.textSize = 18f }
        supabaseUrlInput = EditText(this).also { it.hint = "Supabase URL" }
        anonKeyInput = EditText(this).also { it.hint = "Supabase anon key" }
        enrollmentCodeInput = EditText(this).also { it.hint = "Enrollment code" }
        displayNameInput = EditText(this).also { it.hint = "Display name" }
        simulatedSwitch = Switch(this).also { it.text = "Use simulated reader"; it.isChecked = true }
        enrollButton = Button(this).also { it.text = "Enroll bridge"; it.setOnClickListener { enrollBridge() } }
        cancelButton = Button(this).also { it.text = "Cancel active payment"; it.setOnClickListener { cancelActivePayment() } }
        resetButton = Button(this).also { it.text = "Reset enrollment"; it.setOnClickListener { resetEnrollment() } }
        listOf(status, supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton, simulatedSwitch, cancelButton, resetButton).forEach(root::addView)
        setContentView(root)
    }

    private fun showEnrollment() {
        status.text = "Cashmint payment bridge\nNot enrolled"
        listOf(supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton).forEach { it.visibility = View.VISIBLE }
        cancelButton.isEnabled = false
    }

    private fun showDiagnostics() {
        listOf(supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton).forEach { it.visibility = View.GONE }
        cancelButton.isEnabled = true
        status.text = "Cashmint payment bridge\n${credentials.restaurantName} / ${credentials.locationName}\nDevice ${credentials.deviceId}\nReader reconnecting..."
    }

    private fun enrollBridge() {
        val url = supabaseUrlInput.text.toString().trim().trimEnd('/')
        val anonKey = anonKeyInput.text.toString().trim()
        val code = enrollmentCodeInput.text.toString().trim()
        val displayName = displayNameInput.text.toString().trim().ifBlank { "Cashmint bridge" }
        if (url.isBlank() || anonKey.isBlank() || code.isBlank()) {
            status.text = "Supabase URL, anon key, and enrollment code are required."
            return
        }
        api = BridgeApi(url, anonKey) { credentials.accessToken() }
        status.text = "Registering terminal device..."
        api.enroll(code, displayName) { result ->
            runOnUiThread {
                result.onSuccess {
                    credentials.saveEnrollment(it)
                    api = BridgeApi(credentials.supabaseUrl, credentials.anonKey) { credentials.accessToken() }
                    requestPermissionsIfNeeded()
                }.onFailure {
                    status.text = "Enrollment failed: ${it.message}"
                }
            }
        }
    }

    private fun resetEnrollment() {
        paymentCancelable?.cancel(emptyCallback)
        discoveryCancelable?.cancel(emptyCallback)
        BridgeWorker.stop()
        credentials.clear()
        activeRequestId = null
        showEnrollment()
    }

    private fun requestPermissionsIfNeeded() {
        val required = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        if (required.any { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }) permissions.launch(required) else initializeTerminal()
    }

    private fun initializeTerminal() {
        showDiagnostics()
        if (!Terminal.isInitialized()) {
            Terminal.init(applicationContext, LogLevel.INFO, object : ConnectionTokenProvider {
                override fun fetchConnectionToken(callback: ConnectionTokenCallback) {
                    api.connectionToken { result ->
                        result.fold(callback::onSuccess) { callback.onFailure(com.stripe.stripeterminal.external.models.ConnectionTokenException("Connection token failed", it)) }
                    }
                }
            }, this, object : OfflineListener {
                override fun onOfflineStatusChange(offlineStatus: OfflineStatus) = Unit
                override fun onPaymentIntentForwarded(paymentIntent: PaymentIntent, e: TerminalException?) = Unit
                override fun onForwardingFailure(e: TerminalException) = Unit
            })
        }
        BridgeWorker.start(this, api, ::onClaimedPaymentRequest, ::onCancelRequested)
        discoverReader(simulatedSwitch.isChecked)
    }

    private fun discoverReader(simulated: Boolean) {
        discoveryCancelable?.cancel(emptyCallback)
        BridgeWorker.readerDisconnected()
        status.text = "Discovering ${if (simulated) "simulated" else "physical WisePad 3"} reader..."
        val config = DiscoveryConfiguration.BluetoothDiscoveryConfiguration(0, simulated)
        discoveryCancelable = Terminal.getInstance().discoverReaders(config, object : DiscoveryListener {
            override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                readers.firstOrNull()?.let(::connectReader)
            }
        }, object : Callback {
            override fun onSuccess() = Unit
            override fun onFailure(e: TerminalException) { runOnUiThread { status.text = "Reader discovery failed: ${e.errorCode}" } }
        })
    }

    private fun connectReader(reader: Reader) {
        val stripeLocation = credentials.stripeLocationId
        if (stripeLocation.isBlank()) {
            status.text = "Enrollment has no Stripe location."
            return
        }
        val config = ConnectionConfiguration.BluetoothConnectionConfiguration(stripeLocation, true, mobileReaderListener)
        Terminal.getInstance().connectReader(reader, config, object : ReaderCallback {
            override fun onSuccess(reader: Reader) {
                BridgeWorker.readerConnected()
                runOnUiThread { status.text = "Reader connected: ${reader.serialNumber}\nWaiting for payment requests..." }
            }
            override fun onFailure(e: TerminalException) {
                BridgeWorker.readerDisconnected()
                runOnUiThread { status.text = "Reader connection failed: ${e.errorCode}" }
            }
        })
    }

    private fun onClaimedPaymentRequest(requestId: String) {
        activeRequestId = requestId
        runOnUiThread { status.text = "Payment request claimed\n$requestId\nCreating/retrieving PaymentIntent..." }
        api.createIntent(requestId) { created ->
            created.onSuccess { payload ->
                Terminal.getInstance().retrievePaymentIntent(payload.clientSecret, object : PaymentIntentCallback {
                    override fun onSuccess(intent: PaymentIntent) {
                        BridgeWorker.markWaiting(requestId)
                        runOnUiThread { status.text = "Waiting for card on reader..." }
                        paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                            intent,
                            object : PaymentIntentCallback {
                                override fun onSuccess(collected: PaymentIntent) {
                                    BridgeWorker.markProcessing(requestId)
                                    runOnUiThread { status.text = "Processing card payment..." }
                                    paymentCancelable = Terminal.getInstance().processPaymentIntent(
                                        collected,
                                        CollectPaymentIntentConfiguration.Builder().build(),
                                        ConfirmPaymentIntentConfiguration.Builder().build(),
                                        object : PaymentIntentCallback {
                                            override fun onSuccess(result: PaymentIntent) {
                                                BridgeWorker.markUnknownUntilWebhook(requestId)
                                                activeRequestId = null
                                                runOnUiThread { status.text = "Payment submitted; awaiting Stripe webhook confirmation." }
                                            }
                                            override fun onFailure(e: TerminalException) = failOrReconcile(requestId, e)
                                        }
                                    )
                                }
                                override fun onFailure(e: TerminalException) = failOrReconcile(requestId, e)
                            },
                            CollectPaymentIntentConfiguration.Builder()
                                .setCustomerCancellation(CustomerCancellation.ENABLE_IF_AVAILABLE)
                                .build()
                        )
                    }
                    override fun onFailure(e: TerminalException) = failOrReconcile(requestId, e)
                })
            }.onFailure { BridgeWorker.markFailureOrUnknown(requestId, it) }
        }
    }

    private fun failOrReconcile(requestId: String, error: TerminalException) {
        api.status(requestId) { result ->
            result.onSuccess {
                BridgeWorker.markFailureOrUnknown(requestId, error)
            }.onFailure {
                BridgeWorker.markFailureOrUnknown(requestId, error)
            }
        }
        activeRequestId = null
        runOnUiThread { status.text = "Payment state unknown; waiting for server reconciliation.\n${error.errorCode}" }
    }

    private fun cancelActivePayment() {
        val requestId = activeRequestId ?: credentials.activeRequestId()
        if (requestId.isBlank()) {
            status.text = "No active payment to cancel."
            return
        }
        api.cancelPayment(requestId) { }
        paymentCancelable?.cancel(object : Callback {
            override fun onSuccess() {
                BridgeWorker.markCancelled(requestId)
                activeRequestId = null
                runOnUiThread { status.text = "Payment cancelled." }
            }
            override fun onFailure(e: TerminalException) { runOnUiThread { status.text = "Cancel failed: ${e.errorCode}" } }
        })
    }

    private fun onCancelRequested(requestId: String) {
        paymentCancelable?.cancel(object : Callback {
            override fun onSuccess() {
                BridgeWorker.markCancelled(requestId)
                activeRequestId = null
                runOnUiThread { status.text = "Payment cancelled from POS." }
            }
            override fun onFailure(e: TerminalException) {
                BridgeWorker.markFailureOrUnknown(requestId, e)
                runOnUiThread { status.text = "Cancel requested; state unknown: ${e.errorCode}" }
            }
        })
    }

    private val emptyCallback = object : Callback {
        override fun onSuccess() = Unit
        override fun onFailure(e: TerminalException) = Unit
    }

    private val mobileReaderListener = object : MobileReaderListener {
        override fun onDisconnect(reason: DisconnectReason) {
            BridgeWorker.readerDisconnected()
            runOnUiThread { status.text = "Reader disconnected: $reason" }
        }
    }
}
