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
    private val locallyCancelledRequests = mutableSetOf<String>()
    private var lastReader: Reader? = null
    private var isDiscovering = false
    private var isConnectingReader = false
    private var isStoppingDiscoveryForConnect = false
    private var retryDiscoveryOnResume = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var paymentGeneration = 0
    private var processRetryUsed = false
    private var activeStartedAt = 0L
    private val finalizedRequests = mutableSetOf<String>()

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        if (results.values.all { it }) prepareReaderDiscovery() else showMissingPermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        credentials = BridgeCredentials(this)
        api = BridgeApi(credentials.supabaseUrl, credentials.anonKey, { credentials.accessToken() }, { credentials.realtimeKey().ifBlank { credentials.anonKey } })
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
        enrollButton = Button(this).also { it.text = "Enroll bridge"; it.setOnClickListener { enrollBridge() } }
        cancelButton = Button(this).also { it.text = "Cancel active payment"; it.setOnClickListener { cancelActivePayment() } }
        reconnectButton = Button(this).also { it.text = "Discover / reconnect WisePad 3"; it.setOnClickListener { reconnectReader() } }
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
        listOf(status, supabaseUrlInput, anonKeyInput, enrollmentCodeInput, displayNameInput, enrollButton, deviceDetails, readerDetails, reconnectButton, locationSettingsButton, bluetoothSettingsButton, paymentDetails, cancelButton, retryButton, diagnostics, clearDiagnosticsButton, resetButton).forEach(root::addView)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (retryDiscoveryOnResume && ::credentials.isInitialized && credentials.enrolled()) {
            retryDiscoveryOnResume = false
            prepareReaderDiscovery()
        }
        if (::credentials.isInitialized && credentials.enrolled()) BridgeWorker.requestServerSync()
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
        readerDetails.text = "Reader: ready\nMode: physical WisePad 3\nTap Discover / reconnect WisePad 3 when the reader is awake."
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
        api = BridgeApi(url, anonKey, { credentials.accessToken() })
        status.text = "Registering terminal device..."
        api.enroll(code, displayName) { result ->
            runOnUiThread {
                result.onSuccess {
                    credentials.saveEnrollment(it)
                    api = BridgeApi(credentials.supabaseUrl, credentials.anonKey, { credentials.accessToken() }, { credentials.realtimeKey().ifBlank { credentials.anonKey } })
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
        isDiscovering = false
        isConnectingReader = false
        isStoppingDiscoveryForConnect = false
        reconnectButton.isEnabled = true
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
        BridgeWorker.start(this, api, ::onClaimedPaymentRequest, ::onCancelRequested, ::onServerIdle)
        readerDetails.text = "Reader: ready\nMode: physical WisePad 3\nTap Discover / reconnect WisePad 3 when the reader is awake."
        status.text = "Cashmint payment bridge ready"
        renderDiagnostics()
    }

    private fun reconnectReader() {
        if (isDiscovering || isConnectingReader) {
            status.text = "Reader setup is already running..."
            readerDetails.text = "Reader: ${if (isConnectingReader) "connecting" else "discovering"}\nMode: physical WisePad 3\nWait for this step to finish before trying again."
            renderDiagnostics()
            return
        }
        if (!Terminal.isInitialized()) {
            prepareReaderDiscovery()
            return
        }
        val connected = Terminal.getInstance().connectedReader
        if (connected == null) {
            discoverReader()
            return
        }
        BridgeWorker.readerDisconnected()
        readerDetails.text = "Reader: reconnecting\nDisconnecting current reader before physical WisePad 3 discovery."
        status.text = "Disconnecting current reader..."
        Terminal.getInstance().disconnectReader(object : Callback {
            override fun onSuccess() {
                runOnUiThread { discoverReader(allowAlreadyConnectedRecovery = false) }
            }
            override fun onFailure(e: TerminalException) {
                runOnUiThread {
                    readerDetails.text = "Reader: disconnect failed\nSafe error: ${e.errorCode}"
                    status.text = "Reader disconnect failed: ${e.errorCode}"
                    renderDiagnostics()
                }
            }
        })
    }

    private fun discoverReader(allowAlreadyConnectedRecovery: Boolean = true) {
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
        if (Terminal.isInitialized()) {
            val connected = Terminal.getInstance().connectedReader
            if (connected != null) {
                BridgeWorker.readerConnected()
                lastReader = connected
                listOf(locationSettingsButton, bluetoothSettingsButton).forEach { it.visibility = View.GONE }
                readerDetails.text = "Reader: connected\nSerial: ${connected.serialNumber}\nAlready connected; no discovery needed."
                status.text = "Reader already connected: ${connected.serialNumber}"
                renderDiagnostics()
                return
            }
        }
        if (isDiscovering) {
            status.text = "Reader discovery is already running..."
            readerDetails.text = "Reader: discovering\nMode: physical WisePad 3\nWait for discovery to finish before trying again."
            renderDiagnostics()
            return
        }
        BridgeWorker.readerDisconnected()
        isDiscovering = true
        isConnectingReader = false
        isStoppingDiscoveryForConnect = false
        reconnectButton.isEnabled = false
        listOf(locationSettingsButton, bluetoothSettingsButton).forEach { it.visibility = View.GONE }
        readerDetails.text = "Reader: discovering\nMode: physical WisePad 3\nDo not pair this reader in Android Bluetooth settings."
        status.text = "Discovering physical WisePad 3 reader..."
        val config = DiscoveryConfiguration.BluetoothDiscoveryConfiguration(0, false)
        discoveryCancelable = Terminal.getInstance().discoverReaders(config, object : DiscoveryListener {
            override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                runOnUiThread { readerDetails.text = "Reader: ${readers.size} discovered\nMode: physical WisePad 3\nSelects the first available Stripe reader." }
                if (!isConnectingReader) {
                    readers.firstOrNull()?.let { reader ->
                        isConnectingReader = true
                        lastReader = reader
                        stopDiscoveryAndConnect(reader)
                    }
                }
            }
        }, object : Callback {
            override fun onSuccess() {
                isDiscovering = false
                discoveryCancelable = null
                runOnUiThread {
                    reconnectButton.isEnabled = true
                    renderDiagnostics()
                }
            }
            override fun onFailure(e: TerminalException) {
                if (isStoppingDiscoveryForConnect && e.errorCode.toString().contains("CANCELED")) {
                    isDiscovering = false
                    discoveryCancelable = null
                    return
                }
                isDiscovering = false
                discoveryCancelable = null
                BridgeWorker.readerDisconnected()
                if (allowAlreadyConnectedRecovery && e.errorCode.toString().contains("ALREADY_CONNECTED_TO_READER")) {
                    runOnUiThread {
                        reconnectButton.isEnabled = true
                        readerDetails.text = "Reader: resetting stale connection\nStripe reported an already-connected reader; disconnecting and retrying discovery."
                        status.text = "Resetting reader connection..."
                        renderDiagnostics()
                    }
                    Terminal.getInstance().disconnectReader(object : Callback {
                        override fun onSuccess() {
                            runOnUiThread { discoverReader(allowAlreadyConnectedRecovery = false) }
                        }
                        override fun onFailure(disconnectError: TerminalException) {
                            runOnUiThread {
                                reconnectButton.isEnabled = true
                                isConnectingReader = false
                                readerDetails.text = "Reader: reset failed\nSafe error: ${disconnectError.errorCode}"
                                status.text = "Reader reset failed: ${disconnectError.errorCode}"
                                renderDiagnostics()
                            }
                        }
                    })
                    return
                }
                if (e.errorCode.toString().contains("CANCELED")) {
                    runOnUiThread {
                        reconnectButton.isEnabled = true
                        isConnectingReader = false
                        readerDetails.text = "Reader: ready\nDiscovery was canceled. Tap Discover / reconnect WisePad 3 once to start again."
                        status.text = "Reader discovery canceled"
                        renderDiagnostics()
                    }
                    return
                }
                runOnUiThread {
                    reconnectButton.isEnabled = true
                    isConnectingReader = false
                    readerDetails.text = "Reader: discovery failed\nSafe error: ${e.errorCode}"
                    status.text = "Reader discovery failed: ${e.errorCode}"
                    renderDiagnostics()
                }
            }
        })
    }

    private fun stopDiscoveryAndConnect(reader: Reader) {
        runOnUiThread {
            readerDetails.text = "Reader: found\nSerial: ${reader.serialNumber ?: "unknown"}\nStopping discovery before connecting..."
            status.text = "WisePad 3 found; connecting..."
            renderDiagnostics()
        }
        val activeDiscovery = discoveryCancelable
        if (activeDiscovery == null) {
            isDiscovering = false
            connectReader(reader)
            return
        }
        isStoppingDiscoveryForConnect = true
        activeDiscovery.cancel(object : Callback {
            override fun onSuccess() {
                runOnUiThread {
                    isStoppingDiscoveryForConnect = false
                    isDiscovering = false
                    discoveryCancelable = null
                    connectReader(reader)
                }
            }

            override fun onFailure(e: TerminalException) {
                runOnUiThread {
                    isStoppingDiscoveryForConnect = false
                    isDiscovering = false
                    discoveryCancelable = null
                    connectReader(reader)
                }
            }
        })
    }

    private fun connectReader(reader: Reader) {
        val stripeLocation = credentials.stripeLocationId
        if (stripeLocation.isBlank()) {
            isConnectingReader = false
            reconnectButton.isEnabled = true
            status.text = "Enrollment has no Stripe location."
            return
        }
        runOnUiThread {
            readerDetails.text = "Reader: connecting\nSerial: ${reader.serialNumber ?: "unknown"}\nFollow any prompt on the WisePad 3 screen."
            status.text = "Connecting WisePad 3..."
            renderDiagnostics()
        }
        val config = ConnectionConfiguration.BluetoothConnectionConfiguration(stripeLocation, true, mobileReaderListener)
        Terminal.getInstance().connectReader(reader, config, object : ReaderCallback {
            override fun onSuccess(reader: Reader) {
                BridgeWorker.readerConnected()
                isDiscovering = false
                isConnectingReader = false
                isStoppingDiscoveryForConnect = false
                discoveryCancelable = null
                runOnUiThread {
                    reconnectButton.isEnabled = true
                    readerDetails.text = "Reader: connected\nSerial: ${reader.serialNumber}\nPairing code: follow the code shown on the WisePad screen, if prompted."
                    renderDiagnostics()
                }
            }
            override fun onFailure(e: TerminalException) {
                BridgeWorker.readerDisconnected()
                isDiscovering = false
                isConnectingReader = false
                isStoppingDiscoveryForConnect = false
                discoveryCancelable = null
                runOnUiThread {
                    reconnectButton.isEnabled = true
                    status.text = "Reader connection failed: ${e.errorCode}"
                    readerDetails.text = "Reader: connection failed\nSafe error: ${e.errorCode}"
                    renderDiagnostics()
                }
            }
        })
    }

    private fun onClaimedPaymentRequest(requestId: String) {
        if (locallyCancelledRequests.contains(requestId)) {
            BridgeWorker.release(requestId)
            return
        }
        if (activeRequestId != null && activeRequestId != requestId) {
            BridgeWorker.release(requestId)
            return
        }
        if (finalizedRequests.contains(requestId)) {
            BridgeWorker.release(requestId)
            return
        }
        if (paymentCancelable != null) {
            BridgeWorker.markUnknownUntilWebhook(requestId)
            pollStripeCompletion(requestId, paymentGeneration, System.currentTimeMillis())
            return
        }
        activeRequestId = requestId
        lastClaimedRequestId = requestId
        paymentGeneration += 1
        val generation = paymentGeneration
        processRetryUsed = false
        activeStartedAt = System.currentTimeMillis()
        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: claimed / creating_payment_intent"; retryButton.isEnabled = false }
        api.createIntent(requestId) { created ->
            if (!isCurrentPayment(requestId, generation)) return@createIntent
            created.onSuccess { payload ->
                Terminal.getInstance().retrievePaymentIntent(payload.clientSecret, object : PaymentIntentCallback {
                    override fun onSuccess(intent: PaymentIntent) {
                        if (!isCurrentPayment(requestId, generation)) return
                        if (PaymentFlowPolicy.isFinalRequestStatus(stripeStatusName(intent.status.toString()))) {
                            reconcileStripeStatus(requestId, generation, stripeStatusName(intent.status.toString()), intent)
                            return
                        }
                        BridgeWorker.markWaiting(requestId)
                        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: waiting_for_card\nPresent card on reader." }
                        BridgeWorker.setReaderAction(ReaderActionState.COLLECTING)
                        paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                            intent,
                            object : PaymentIntentCallback {
                                override fun onSuccess(collected: PaymentIntent) {
                                    if (!isCurrentPayment(requestId, generation)) return
                                    BridgeWorker.markProcessing(requestId)
                                    runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: processing" }
                                    processPaymentOnce(requestId, generation, collected)
                                }
                                override fun onFailure(e: TerminalException) = failOrReconcile(requestId, generation, e)
                            },
                            CollectPaymentIntentConfiguration.Builder()
                                .setCustomerCancellation(CustomerCancellation.ENABLE_IF_AVAILABLE)
                                .build()
                        )
                    }
                    override fun onFailure(e: TerminalException) = failOrReconcile(requestId, generation, e)
                })
            }.onFailure { failOrReconcile(requestId, generation, it) }
        }
    }

    private fun onServerIdle() {
        val staleRequestId = activeRequestId ?: credentials.activeRequestId()
        finalizedRequests.add(staleRequestId.orEmpty())
        paymentGeneration += 1
        processRetryUsed = false
        activeRequestId = null
        credentials.setActiveRequestId(null)
        val cancelable = paymentCancelable
        paymentCancelable = null
        cancelable?.cancel(emptyCallback)
        runOnUiThread {
            retryButton.isEnabled = false
            status.text = "Cashmint payment bridge ready"
            paymentDetails.text = if (staleRequestId.isNullOrBlank()) {
                "Payment request: none\nState: idle"
            } else {
                "Payment request: none\nState: idle\nLast completed request: $staleRequestId"
            }
            renderDiagnostics()
        }
    }

    private fun processPaymentOnce(requestId: String, generation: Int, intent: PaymentIntent) {
        BridgeWorker.setReaderAction(ReaderActionState.PROCESSING)
        paymentCancelable = Terminal.getInstance().processPaymentIntent(
            intent,
            CollectPaymentIntentConfiguration.Builder().build(),
            ConfirmPaymentIntentConfiguration.Builder().build(),
            object : PaymentIntentCallback {
                override fun onSuccess(result: PaymentIntent) {
                    if (!isCurrentPayment(requestId, generation)) return
                    paymentCancelable = null
                    reconcileStripeStatus(requestId, generation, stripeStatusName(result.status.toString()), result)
                }

                override fun onFailure(e: TerminalException) = failOrReconcile(requestId, generation, e)
            }
        )
    }

    private fun failOrReconcile(requestId: String, generation: Int, error: Throwable) {
        if (!isCurrentPayment(requestId, generation)) return
        paymentCancelable = null
        if (locallyCancelledRequests.contains(requestId)) {
            finalizePayment(requestId, "cancelled", "Payment was cancelled locally.", updateBackend = true)
            return
        }
        api.status(requestId) { result ->
            if (!isCurrentPayment(requestId, generation)) return@status
            result.onSuccess { status ->
                reconcileStripeStatus(requestId, generation, status.optString("status"), null, error.message)
            }.onFailure {
                BridgeWorker.markFailureOrUnknown(requestId, error)
                runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: unknown\nNetwork error while checking Stripe. Waiting for webhook."; retryButton.isEnabled = false; renderDiagnostics() }
                pollStripeCompletion(requestId, generation, System.currentTimeMillis())
            }
        }
        runOnUiThread { paymentDetails.text = "Payment request: $requestId\nState: reconciling\nChecking Stripe result: ${error.message}"; retryButton.isEnabled = false; renderDiagnostics() }
    }

    private fun reconcileStripeStatus(requestId: String, generation: Int, stripeStatus: String, intent: PaymentIntent? = null, fallbackMessage: String? = null) {
        if (!isCurrentPayment(requestId, generation)) return
        when (PaymentFlowPolicy.decideStripeStatus(stripeStatusName(stripeStatus), processRetryUsed)) {
            PaymentDecision.FAIL_FINAL -> finalizePayment(requestId, "failed", fallbackMessage ?: "Payment timed out or was declined. Start a new card payment from the cashier.", updateBackend = true)
            PaymentDecision.RETRY_PROCESS_ONCE -> {
                val retryIntent = intent
                if (retryIntent == null) {
                    BridgeWorker.markUnknownUntilWebhook(requestId)
                    pollStripeCompletion(requestId, generation, System.currentTimeMillis())
                    return
                }
                processRetryUsed = true
                processPaymentOnce(requestId, generation, retryIntent)
            }
            PaymentDecision.WAIT_FOR_WEBHOOK, PaymentDecision.KEEP_WAITING, PaymentDecision.UNKNOWN_RECONCILE -> {
                BridgeWorker.markUnknownUntilWebhook(requestId)
                runOnUiThread {
                    paymentDetails.text = "Payment request: $requestId\nState: unknown\nAwaiting Stripe webhook confirmation."
                    retryButton.isEnabled = false
                    renderDiagnostics()
                }
                pollStripeCompletion(requestId, generation, System.currentTimeMillis())
            }
            PaymentDecision.CANCEL_FINAL -> finalizePayment(requestId, "cancelled", "Payment cancelled.", updateBackend = true)
            PaymentDecision.SUCCEEDED_CONFIRMED -> finalizePayment(requestId, "succeeded", "Order completion is confirmed by Stripe webhook.", updateBackend = false)
        }
    }

    private fun pollStripeCompletion(requestId: String, generation: Int, unknownStartedAt: Long) {
        if (!isCurrentPayment(requestId, generation)) return
        val elapsed = System.currentTimeMillis() - activeStartedAt
        if (elapsed >= PaymentFlowPolicy.TOTAL_WORKFLOW_TIMEOUT_MS) {
            BridgeWorker.markUnknownUntilWebhook(requestId)
            runOnUiThread {
                paymentDetails.text = "Payment request: $requestId\nState: unknown\nStripe confirmation is still pending. Do not start another card payment for this order until the cashier updates."
                retryButton.isEnabled = true
                renderDiagnostics()
            }
            return
        }
        val delay = PaymentFlowPolicy.pollDelayMs(System.currentTimeMillis() - unknownStartedAt)
        mainHandler.postDelayed({
            if (!isCurrentPayment(requestId, generation)) return@postDelayed
            api.status(requestId) { result ->
                if (!isCurrentPayment(requestId, generation)) return@status
                result.onSuccess { status ->
                    when (status.optString("status")) {
                        "succeeded" -> {
                            finalizePayment(requestId, "succeeded", "Order completion is confirmed by Stripe webhook.", updateBackend = false)
                        }
                        "cancel_requested", "cancelled" -> {
                            finalizePayment(requestId, "cancelled", "Payment cancelled.", updateBackend = true)
                        }
                        "failed", "requires_payment_method" -> {
                            finalizePayment(requestId, "failed", status.optString("failure_message").ifBlank { "Payment timed out or was declined. Start a new card payment from the cashier." }, updateBackend = true)
                        }
                        "canceled" -> {
                            finalizePayment(requestId, "cancelled", "Stripe status: canceled", updateBackend = true)
                        }
                        else -> pollStripeCompletion(requestId, generation, unknownStartedAt)
                    }
                }.onFailure { pollStripeCompletion(requestId, generation, unknownStartedAt) }
            }
        }, delay)
    }

    private fun isCurrentPayment(requestId: String, generation: Int): Boolean {
        if (finalizedRequests.contains(requestId)) return false
        return activeRequestId == requestId && paymentGeneration == generation
    }

    private fun stripeStatusName(value: String): String =
        value.substringAfterLast('.').lowercase()

    private fun finalizePayment(requestId: String, finalState: String, message: String, updateBackend: Boolean) {
        finalizedRequests.add(requestId)
        paymentGeneration += 1
        paymentCancelable = null
        activeRequestId = null
        processRetryUsed = false
        if (updateBackend) {
            when (finalState) {
                "failed" -> BridgeWorker.markFailed(requestId, message)
                "cancelled" -> BridgeWorker.markCancelled(requestId)
                else -> BridgeWorker.release(requestId)
            }
        } else {
            BridgeWorker.release(requestId)
        }
        runOnUiThread {
            paymentDetails.text = "Payment request: $requestId\nState: $finalState\n$message"
            retryButton.isEnabled = finalState == "unknown"
            renderDiagnostics()
        }
    }

    private fun cancelActivePayment() {
        val requestId = activeRequestId ?: credentials.activeRequestId()
        if (requestId.isBlank()) {
            status.text = "No active payment to cancel."
            return
        }
        locallyCancelledRequests.add(requestId)
        paymentGeneration += 1
        BridgeWorker.setReaderAction(ReaderActionState.CANCELLING)
        retryButton.isEnabled = false
        paymentDetails.text = "Payment request: $requestId\nState: cancelling"
        api.cancelPayment(requestId) { }
        val cancelable = paymentCancelable
        paymentCancelable = null
        if (cancelable == null) {
            finalizePayment(requestId, "cancelled", "Payment cancellation requested.", updateBackend = true)
            return
        }
        cancelable.cancel(object : Callback {
            override fun onSuccess() {
                finalizePayment(requestId, "cancelled", "Payment cancellation requested.", updateBackend = true)
            }
            override fun onFailure(e: TerminalException) {
                finalizePayment(requestId, "cancelled", "Cancel requested: ${e.errorCode}", updateBackend = true)
            }
        })
    }

    private fun onCancelRequested(requestId: String) {
        locallyCancelledRequests.add(requestId)
        paymentGeneration += 1
        BridgeWorker.setReaderAction(ReaderActionState.CANCELLING)
        val cancelable = paymentCancelable
        paymentCancelable = null
        if (cancelable == null) {
            finalizePayment(requestId, "cancelled", "Payment cancellation requested.", updateBackend = true)
            return
        }
        cancelable.cancel(object : Callback {
            override fun onSuccess() {
                finalizePayment(requestId, "cancelled", "Payment cancellation requested.", updateBackend = true)
            }
            override fun onFailure(e: TerminalException) {
                finalizePayment(requestId, "cancelled", "Cancel requested: ${e.errorCode}", updateBackend = true)
            }
        })
    }

    private val emptyCallback = object : Callback {
        override fun onSuccess() = Unit
        override fun onFailure(e: TerminalException) = Unit
    }

    private val mobileReaderListener = object : MobileReaderListener {
        override fun onReportAvailableUpdate(update: ReaderSoftwareUpdate) {
            runOnUiThread {
                reconnectButton.isEnabled = false
                readerDetails.text = "Reader: firmware update available\nVersion: ${update.version ?: "unknown"}\nInstalling update before taking payments."
                status.text = "Installing WisePad 3 update..."
                renderDiagnostics()
            }
            Terminal.getInstance().installAvailableUpdate()
        }

        override fun onStartInstallingUpdate(update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
            runOnUiThread {
                reconnectButton.isEnabled = false
                readerDetails.text = "Reader: installing update\nVersion: ${update.version ?: "unknown"}\nKeep the WisePad 3 powered on and nearby."
                status.text = "Installing WisePad 3 update..."
                renderDiagnostics()
            }
        }

        override fun onReportReaderSoftwareUpdateProgress(progress: Float) {
            val percent = (progress * 100).toInt().coerceIn(0, 100)
            runOnUiThread {
                readerDetails.text = "Reader: installing update\nProgress: $percent%\nKeep the WisePad 3 powered on and nearby."
                status.text = "WisePad 3 update $percent%"
                renderDiagnostics()
            }
        }

        override fun onDisconnect(reason: DisconnectReason) {
            BridgeWorker.readerDisconnected()
            isDiscovering = false
            isConnectingReader = false
            isStoppingDiscoveryForConnect = false
            discoveryCancelable = null
            runOnUiThread {
                reconnectButton.isEnabled = true
                readerDetails.text = "Reader: disconnected\nReason: $reason\nTap Discover / reconnect WisePad 3 when the reader is awake."
                renderDiagnostics()
            }
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

    private fun renderDiagnostics() { diagnostics.text = "Diagnostics\n${BridgeWorker.diagnostics()}\nStripe: ${if (Terminal.isInitialized()) "initialized" else "not initialized"}\nApp version: 1.0.15" }

    override fun onConnectionStatusChange(status: ConnectionStatus) { runOnUiThread { renderDiagnostics() } }
    override fun onPaymentStatusChange(status: PaymentStatus) { runOnUiThread { renderDiagnostics() } }
}
