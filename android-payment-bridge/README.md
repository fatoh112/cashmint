# Cashmint Android payment bridge

This APK is intentionally not a POS. It holds a registered bridge identity in Android Keystore-backed storage, reports a 20-second heartbeat, subscribes to Supabase Realtime payment requests, atomically claims one, and uses Stripe Terminal Android SDK **5.7.0** to process it on the BBPOS WisePad 3.

Before building, complete the `BridgeCredentials` and `BridgeWorker` production adapters: the former uses Supabase Auth to refresh the enrolled bridge JWT; the latter owns Realtime subscription, Bluetooth-proximity discovery/reconnect, single-flight claim, and calls the four constrained payment RPCs. Their interfaces are intentionally isolated so no credentials or order amount can enter UI code.

On Windows with Android Studio/Gradle installed:

```powershell
cd android-payment-bridge
.\gradlew.bat assembleDebug
```

Install `app\build\outputs\apk\debug\app-debug.apk` via USB/ADB. Test with a Stripe simulated Bluetooth reader first, then the Restaurant 1 WisePad 3 in Stripe test mode. Do not turn on live mode until webhook, receipt, cancellation, restart-recovery, and duplicate-claim tests pass.
