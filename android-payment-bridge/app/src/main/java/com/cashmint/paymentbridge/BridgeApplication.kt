package com.cashmint.paymentbridge

import android.app.Application
import com.stripe.stripeterminal.TerminalApplicationDelegate

class BridgeApplication : Application() {
    override fun onCreate() { super.onCreate(); TerminalApplicationDelegate.onCreate(this) }
}
