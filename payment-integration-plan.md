# Restaurant 1 payment integration

## Current flow

`src/App.jsx` creates an accounting order through `create_accounting_order`. Cash orders complete and print immediately; card orders remain `pending`. The existing orders Realtime listener prints through `src/utils/printerService.js` only when that order becomes `completed`.

## Implemented file plan

| Area | Files | Responsibility |
|---|---|---|
| Tenant payment model | `supabase/migrations/20260718010000_add_terminal_payments.sql` | Restaurant/location/config/device/request records, RLS, availability, atomic claim, heartbeat and state RPCs. |
| Stripe server boundary | `supabase/functions/_shared/terminal.ts` and six terminal function folders | Registered bridge authentication, connection token, server-derived PaymentIntent, status, cancellation and webhook verification. |
| iPad handoff | `src/App.jsx` | Reader availability, request creation, Realtime status, cancellation; preserves the existing post-webhook receipt print. |
| Android bridge | `android-payment-bridge/` | Kotlin/Stripe Terminal 5.7.0 project shell and payment bridge boundaries, without POS or amount entry. |

## Release gates

1. Apply migration and configure Stripe secrets/webhook as in `supabase/functions/README-terminal-payments.md`.
2. Complete environment-specific Android enrollment/Realtime worker adapters, build a debug APK, and use Stripe's simulated reader.
3. Verify WisePad 3 Bluetooth reconnection, simultaneous-request rejection, cancellation, app restart recovery, webhook retry and Epson receipt behavior in test mode.
4. Review Stripe live account/location configuration and repeat the test checklist before enabling Restaurant 1 live mode.
