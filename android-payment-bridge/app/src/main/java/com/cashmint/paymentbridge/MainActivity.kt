package com.cashmint.paymentbridge

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
import com.stripe.stripeterminal.external.models.ConnectionStatus
import com.stripe.stripeterminal.external.models.CustomerCancellation
import com.stripe.stripeterminal.external.models.DisconnectReason
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.OfflineStatus
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.PaymentStatus
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.ReaderSoftwareUpdate
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
    private lateinit var reconnectButton: Button
    private lateinit var retryButton: Button
    private lateinit var locationSettingsButton: Button
    private lateinit var bluetoothSettingsButton: Button
    private lateinit var clearDiagnosticsButton: Button
    private lateinit var deviceDetails: TextView
    private lateinit var readerDetails: TextView
    private lateinit var paymentDetails: TextView
    private lateinit var diagnostics: TextView
    private var discoveryCancelable: Cancelable? = null
    private var paymentCancelable: Cancelable? = null
    private var activeRequestId: String? = null
    private var lastClaimedRequestId: String? = null
    private var lastReader: Reader? = null
    private var retryDiscoveryOnResume = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        if (results.values.all { it }) prepareReaderDiscovery() else showMissingPermissions()
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
        reconnectButton = Button(this).also { it.text = "Discover / reconnect reader"; it.setOnClickListener { discoverReader(simulatedSwitch.isChecked) } }
        retryButton = Button(this).also { it.text = "Retry safe payment recovery"; it.setOnClickListener { retryActivePayment() } }
        locationSettingsButton = Button(this).also {
            it.text = "Open Location Settings"
            it.visibility = View.GONE
            it.setOnClickListener {
                retryDiscoveryOnResume = true
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
        }
        bluetoothSettingsButton = Button(this).also {
            it.text = "Open Bluetooth Settings"
            it.visibility = View.GONE
            it.setOnClickListener {
                retryDiscoveryOnResume = true
                startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            }
        }
        clearDiagnosticsButton = Button(this).also { it.text = "Clear diagnostics"; it.setOnClickListener { BridgeWorker.clearDiagnostics(); renderDiagnostics() } }
        resetButton = Button(this).also { it.text = "Reset enrollment"; it.setOnClickListener { resetEnrollment() } }
        deviceDetails = TextView(this)
        readerDetails = TextView(this)
        paymentDetails = TextView(this)
        diagnostics = TextView(this)
        simulatedSwitch.setOnCheckedChangeListener { _, checked -> if (credentials.enrolled()) discoverReader(checked) }
        listOf(status, supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton, deviceDetails, simulatedSwitch, readerDetails, reconnectButton, locationSettingsButton, bluetoothSettingsButton, paymentDetails, cancelButton, retryButton, diagnostics, clearDiagnosticsButton, resetButton).forEach(root::addView)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (retryDiscoveryOnResume && ::credentials.isInitialized && credentials.enrolled()) {
            retryDiscoveryOnResume = false
            prepareReaderDiscovery()
        }
    }

    private fun showEnrollment() {
        status.text = "Cashmint payment bridge\nNot enrolled"
        listOf(supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton).forEach { it.visibility = View.VISIBLE }
        listOf(locationSettingsButton, bluetoothSettingsButton).forEach { it.visibility = View.GONE }
        cancelButton.isEnabled = false
        retryButton.isEnabled = false
        listOf(deviceDetails, readerDetails, paymentDetails, diagnostics, reconnectButton, clearDiagnosticsButton).forEach { it.visibility = View.GONE }
    }

    private fun showDiagnostics() {
        listOf(supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton).forEach { it.visibility = View.GONE }
        listOf(locationSettingsButton, bluetoothSettingsButton).forEach { it.visibility = View.GONE }
        cancelButton.isEnabled = true
        retryButton.isEnabled = credentials.activeRequestId().isNotBlank()
        listOf(deviceDetails, readerDetails, paymentDetails, diagnostics, reconnectButton, clearDiagnosticsButton).forEach { it.visibility = View.VISIBLE }
        status.text = "Cashmint payment bridge"
        deviceDetails.text = "Restaurant: ${credentials.restaurantName}\nLocation: ${credentials.locationName}\nDevice ID: ${credentials.deviceId}\nBackend: enrolled"
        readerDetails.text = "Reader: reconnecting\nMode: ${if (simulatedSwitch.isChecked) "simulated" else "physical WisePad 3"}"
        paymentDetails.text = "Payment request: ${credentials.activeRequestId().ifBlank { "none" }}\nState: idle"
        renderDiagnostics()
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
                    prepareReaderDiscovery()
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
        prepareReaderDiscovery()
    }

    private fun prepareReaderDiscovery() {
        val missing = missingPermissions()
        if (missing.isNotEmpty()) {
            showMissingPermissions(missing)
            permissions.launch(missing.toTypedArray())
            return
        }
        if (!isLocationEnabled()) {
            discoveryCancelable?.cancel(emptyCallback)
            BridgeWorker.readerDisconnected()
            locationSettingsButton.visibility = View.VISIBLE
            bluetoothSettingsButton.visibility = View.GONE
            readerDetails.text = "Reader: blocked\nLocation must be enabled to discover the card reader"
            status.text = "Location must be enabled to discover the card reader"
            renderDiagnostics()
            return
        }
        if (!isBluetoothEnabled()) {
            discoveryCancelable?.cancel(emptyCallback)
            BridgeWorker.readerDisconnected()
            locationSettingsButton.visibility = View.GONE
            bluetoothSettingsButton.visibility = View.VISIBLE
            readerDetails.text = "Reader: blocked\nBluetooth must be enabled to discover the card reader"
            status.text = "Bluetooth must be enabled to discover the card reader"
            renderDiagnostics()
            return
        }
        initializeTerminal()
    }

    private fun missingPermissions(): List<String> {
        val required = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            required += Manifest.permission.BLUETOOTH_SCAN
            required += Manifest.permission.BLUETOOTH_CONNECT
        }
        return required.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    }

    private fun showMissingPermissions(missing: List<String> = missingPermissions()) {
        locationSettingsButton.visibility = View.GONE
        bluetoothSettingsButton.visibility = View.GONE
        val labels = missing.map {
            when (it) {
                Manifest.permission.ACCESS_FINE_LOCATION -> "Location permission"
                Manifest.permission.BLUETOOTH_SCAN -> "Bluetooth scan permission"
                Manifest.permission.BLUETOOTH_CONNECT -> "Bluetooth connect permission"
                else -> it
            }
        }
        readerDetails.text = "Reader: blocked\nMissing permission: ${labels.joinToString(", ")}"
        status.text = "Missing permission: ${labels.joinToString(", ")}"
        renderDiagnostics()
    }

    private fun isLocationEnabled(): Boolean {
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.isLocationEnabled
        } else {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
    }

    private fun isBluetoothEnabled(): Boolean {
        val manager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        return manager.adapter?.isEnabled == true
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
        val missing = missingPermissions()
        if (missing.isNotEmpty()) {
            showMissingPermissions(missing)
            permissions.launch(missing.toTypedArray())
            return
        }
        if (!isLocationEnabled()) {
            locationSettingsButton.visibility = View.VISIBLE
            bluetoothSettingsButton.visibility = View.GONE
            readerDetails.text = "Reader: blocked\nLocation must be enabled to discover the card reader"
            status.text = "Location must be enabled to discover the card reader"
            renderDiagnostics()
            return
        }
        if (!isBluetoothEnabled()) {
            locationSettingsButton.visibility = View.GONE
            bluetoothSettingsButton.visibility = View.VISIBLE
            readerDetails.text = "Reader: blocked\nBluetooth must be enabled to discover the card reader"
            status.text = "Bluetooth must be enabled to discover the card reader"
            renderDiagnostics()
            return
        }
        discoveryCancelable?.cancel(emptyCallback)
        BridgeWorker.readerDisconnected()
        listOf(locationSettingsButton, bluetoothSettingsButton).forEach { it.visibility = View.GONE }
        readerDetails.text = "Reader: discovering\nMode: ${if (simulated) "simulated" else "physical WisePad 3"}\nDo not pair this reader in Android Bluetooth settings."
        status.text = "Discovering ${if (simulated) "simulated" else "physical WisePad 3"} reader..."
        val config = DiscoveryConfiguration.BluetoothDiscoveryConfiguration(0, simulated)
        discoveryCancelable = Terminal.getInstance().discoverReaders(config, object : DiscoveryListener {
            override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                runOnUiThread { readerDetails.text = "Reader: ${readers.size} discovered\nMode: ${if (simulated) "simulated" else "physical WisePad 3"}\nSelects the first available Stripe reader." }
                readers.firstOrNull()?.let { reader -> lastReader = reader; connectReader(reader) }
            }
        }, object : Callback {
            override fun onSuccess() = Unit
            override fun onFailure(e: TerminalException) {
                BridgeWorker.readerDisconnected()
                runOnUiThread {
                    readerDetails.text = "Reader: discovery failed\nSafe error: ${e.errorCode}"
                    status.text = "Reader discovery failed: ${e.errorCode}"
                    renderDiagnostics()
                }
            }
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
                runOnUiThread { readerDetails.text = "Reader: connected\nSerial: ${reader.serialNumber}\nPairing code: follow the code shown on the WisePad screen, if prompted."; renderDiagnostics() }
            }
            override fun onFailure(e: TerminalException) {
                BridgeWorker.readerDisconnected()
                runOnUiThread { status.text = "Reader connection failed: ${e.errorCode}" }
            }
        })
    }

    private fun onClaimedPaymentRequest(requestId: String) {
        activeRequestId = requestId
        lastClaimedRequestId = requestId
        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: claimed / creating_payment_intent"; retryButton.isEnabled = false }
        api.createIntent(requestId) { created ->
            created.onSuccess { payload ->
                Terminal.getInstance().retrievePaymentIntent(payload.clientSecret, object : PaymentIntentCallback {
                    override fun onSuccess(intent: PaymentIntent) {
                        BridgeWorker.markWaiting(requestId)
                        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: waiting_for_card\nPresent card on reader." }
                        paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                            intent,
                            object : PaymentIntentCallback {
                                override fun onSuccess(collected: PaymentIntent) {
                                    BridgeWorker.markProcessing(requestId)
                                    runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: processing" }
                                    paymentCancelable = Terminal.getInstance().processPaymentIntent(
                                        collected,
                                        CollectPaymentIntentConfiguration.Builder().build(),
                                        ConfirmPaymentIntentConfiguration.Builder().build(),
                                        object : PaymentIntentCallback {
                                            override fun onSuccess(result: PaymentIntent) {
                                                BridgeWorker.markUnknownUntilWebhook(requestId)
                                                activeRequestId = null
                                                runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: unknown\nAwaiting Stripe webhook confirmation."; renderDiagnostics() }
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
            }.onFailure { failOrReconcile(requestId, it) }
        }
    }

    private fun failOrReconcile(requestId: String, error: Throwable) {
        api.status(requestId) { result ->
            result.onSuccess {
                BridgeWorker.markFailureOrUnknown(requestId, error)
            }.onFailure {
                BridgeWorker.markFailureOrUnknown(requestId, error)
            }
        }
        activeRequestId = null
        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: unknown\nWaiting for server reconciliation: ${error.message}"; retryButton.isEnabled = true; renderDiagnostics() }
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
                runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: cancelled"; retryButton.isEnabled = false }
            }
            override fun onFailure(e: TerminalException) { runOnUiThread { status.text = "Cancel failed: ${e.errorCode}" } }
        })
    }

    private fun onCancelRequested(requestId: String) {
        paymentCancelable?.cancel(object : Callback {
            override fun onSuccess() {
                BridgeWorker.markCancelled(requestId)
                activeRequestId = null
                runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: cancelled"; retryButton.isEnabled = false }
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
        override fun onReportAvailableUpdate(update: ReaderSoftwareUpdate) {
            runOnUiThread { readerDetails.text = "Reader: firmware update required\nInstall the update from this bridge before taking payments." }
        }
        override fun onDisconnect(reason: DisconnectReason) {
            BridgeWorker.readerDisconnected()
            runOnUiThread { readerDetails.text = "Reader: disconnected\nReason: $reason\nAutomatic reconnect scheduled."; renderDiagnostics() }
            mainHandler.postDelayed({ if (credentials.enrolled()) discoverReader(simulatedSwitch.isChecked) }, 5_000)
        }
    }

    private fun retryActivePayment() {
        val id = activeRequestId ?: credentials.activeRequestId() ?: lastClaimedRequestId
        if (id.isNullOrBlank()) { paymentDetails.text = "Payment request: none\nNo payment can be retried."; return }
        api.status(id) { result -> runOnUiThread {
            if (result.isSuccess) {
                paymentDetails.text = "Payment request: $id\nState: reconciling with Stripe; no duplicate charge will be created."
                BridgeWorker.release(id)
            } else paymentDetails.text = "Payment request: $id\nState: retry unavailable: ${result.exceptionOrNull()?.message}"
        } }
    }

    private fun renderDiagnostics() { diagnostics.text = "Diagnostics\n${BridgeWorker.diagnostics()}\nStripe: ${if (Terminal.isInitialized()) "initialized" else "not initialized"}\nApp version: 1.0.1" }

    override fun onConnectionStatusChange(status: ConnectionStatus) { runOnUiThread { renderDiagnostics() } }
    override fun onPaymentStatusChange(status: PaymentStatus) { runOnUiThread { renderDiagnostics() } }
}
