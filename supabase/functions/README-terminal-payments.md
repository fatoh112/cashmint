# Stripe Terminal payment functions

Deploy the terminal functions with JWT verification enabled, except `stripe-terminal-webhook`, which verifies Stripe's signed payload itself:

```powershell
supabase functions deploy create-terminal-enrollment-code
supabase functions deploy register-terminal-device
supabase functions deploy terminal-connection-token
supabase functions deploy create-terminal-payment-intent
supabase functions deploy retrieve-terminal-payment-status
supabase functions deploy cancel-terminal-payment
supabase functions deploy stripe-terminal-webhook --no-verify-jwt
```

Configure secrets only in Supabase:

```powershell
supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_TERMINAL_WEBHOOK_SECRET=whsec_...
```

`restaurant_payment_configs.provider_config` holds non-secret Stripe routing data, for example `{"stripe_account_id":"acct_...","stripe_location_id":"tml_..."}`. Do not place a Stripe secret key, connection token, or webhook secret in this table, the React app, or the Android APK.

Create a Stripe webhook endpoint for `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and `payment_intent.requires_action`. The webhook is the only code path that marks an order as completed; a bridge-reported successful SDK call only leaves the request in `unknown` until Stripe verifies the PaymentIntent.

Stripe Dashboard setup:

1. Create a Terminal Location for each restaurant location.
2. Store only the non-secret `stripe_location_id` and optional Connect `stripe_account_id` in `restaurant_payment_configs.provider_config`.
3. Register the physical WisePad 3 to the matching Stripe Terminal Location before live testing.
4. Point the webhook endpoint at `https://<project-ref>.supabase.co/functions/v1/stripe-terminal-webhook`.
