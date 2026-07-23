import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appSource = read('../App.jsx');
const sharedSource = read('../../supabase/functions/_shared/terminal.ts');
const startSource = read('../../supabase/functions/start-server-driven-terminal-payment/index.ts');
const retrySource = read('../../supabase/functions/retry-server-driven-terminal-payment/index.ts');
const cancelSource = read('../../supabase/functions/cancel-terminal-payment/index.ts');
const retrieveSource = read('../../supabase/functions/retrieve-terminal-payment-status/index.ts');
const webhookSource = read('../../supabase/functions/stripe-terminal-webhook/index.ts');
const manageSource = read('../../supabase/functions/manage-server-driven-reader/index.ts');
const integrationSource = read('../admin/IntegrationSettings.jsx');
const completionMigration = read('../../supabase/migrations/20260722121432_secure_server_driven_terminal_completion.sql');
const staleReaderMigration = read('../../supabase/migrations/20260723160529_recover_stale_server_driven_reader_state.sql');
const posAccessMigration = read('../../supabase/migrations/20260723163259_restore_terminal_rpc_pos_access.sql');
const activePaymentMigration = read('../../supabase/migrations/20260723203259_expose_active_terminal_payment_to_pos.sql');

describe('WisePOS E server-driven regression guards', () => {
  it('sends POS device credentials with server-driven operations', () => {
    expect(appSource).toContain('pos_device_id: deviceAuth?.deviceId || localStorage.getItem(\'device_id\') || null');
    expect(appSource).toContain('pos_device_token: localStorage.getItem(\'device_token\') || null');
    expect(appSource).toContain('retrieve-terminal-payment-status');
    expect(appSource).toContain('retry-server-driven-terminal-payment');
    expect(appSource).toContain('cancel-terminal-payment');
  });

  it('does not send browser-supplied store identity to the Edge Functions', () => {
    expect(appSource).not.toContain('store_id: localStorage.getItem(\'store_id\')');
    expect(sharedSource).toContain('The browser never supplies a trusted store_id');
  });

  it('allows device-only authorization without requiring store_users', () => {
    expect(sharedSource).toContain('terminalPaymentContext');
    expect(sharedSource).toContain(".eq('device_token', deviceToken).eq('status', 'active')");
    expect(sharedSource).toContain("order.pos_device_id && order.pos_device_id !== device.id");
  });

  it('uses caller-scoped is_superadmin checks', () => {
    expect(sharedSource).toContain('userClient.rpc(\'is_superadmin\')');
    expect(manageSource).toContain('client.rpc(\'is_superadmin\')');
    expect(manageSource).not.toContain('db.rpc(\'is_superadmin\')');
  });

  it('starts payment operations through the provider-safe authorization helper', () => {
    expect(startSource).toContain('terminalPaymentContext(req, payment_request_id, input)');
  });

  it('releases an orphaned live Reader action only after confirming no active payment owns it', () => {
    expect(startSource).toContain('releaseOrphanedReaderAction');
    expect(startSource).toContain(".neq('id', request.id)");
    expect(startSource).toContain(".in('status', activeRequestStatuses)");
    expect(startSource).toContain("staleIntent.status === 'succeeded'");
    expect(startSource).toContain('reader-orphan-recovery:${request.id}');
    expect(startSource).toContain("'WisePOS E reader did not release its previous action'");
  });

  it('retry resolves a Stripe Reader ID, never a UUID column', () => {
    expect(retrySource).toContain(".eq('stripe_reader_id', request.stripe_reader_id)");
    expect(retrySource).not.toContain(".eq('id', request.stripe_reader_id)");
  });

  it('cancel resolves a Stripe Reader ID, never a UUID column', () => {
    expect(cancelSource).toContain(".eq('stripe_reader_id', request.stripe_reader_id)");
    expect(cancelSource).not.toContain(".eq('id', request.stripe_reader_id)");
  });

  it('reconciles the Stripe Reader after cancellation instead of leaving a stale busy action', () => {
    expect(cancelSource).toContain('syncServerDrivenReader');
    expect(cancelSource).toContain('reader_release_pending');
    expect(cancelSource).toContain("reader_cancel_action_failed");
    expect(webhookSource).toContain('let cancellationError: string | null = null');
    expect(webhookSource).toContain("reader_cancel_action_failed");
    expect(webhookSource).toContain('const safeMessage = errorMessage(error)');
    expect(cancelSource).toContain('cancellableRequestStatuses');
    expect(cancelSource).toContain('cancellation_pending');
    expect(appSource).toContain('isCancellingPayment');
    expect(appSource).toContain('disabled={isCancellingPayment}');
  });

  it('does not treat a stale stored WisePOS action as busy without an active payment request', () => {
    expect(staleReaderMigration).toContain('pr.stripe_reader_id=v_reader.stripe_reader_id');
    expect(staleReaderMigration).toContain("status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')");
    expect(staleReaderMigration).toContain('v_reader_has_active_payment');
  });

  it('keeps guarded terminal RPCs available to POS-device cashier sessions', () => {
    expect(posAccessMigration).toContain('GRANT EXECUTE ON FUNCTION public.request_terminal_card_payment(UUID,UUID) TO anon, authenticated;');
    expect(posAccessMigration).toContain('GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID,UUID) TO anon, authenticated;');
  });

  it('restores a live terminal payment after a POS reload instead of creating a second order', () => {
    expect(activePaymentMigration).toContain("'active_payment_request_id',v_active_request.id");
    expect(appSource).toContain('resumeActiveTerminalPayment');
    expect(appSource).toContain('availability?.active_payment');
  });

  it('retrieval uses the same trusted completion RPC as the webhook', () => {
    expect(retrieveSource).toContain("db.rpc('complete_terminal_payment'");
    expect(webhookSource).toContain("db.rpc('complete_terminal_payment'");
    expect(retrieveSource).not.toContain("update({status:'succeeded'");
    expect(webhookSource).not.toContain("update({ status:'succeeded'");
  });

  it('does not pay on Reader action success without PaymentIntent success', () => {
    const actionSuccess = webhookSource.indexOf("type === 'terminal.reader.action_succeeded'");
    const actionReturn = webhookSource.indexOf('return json({ received: true })', actionSuccess);
    expect(actionSuccess).toBeGreaterThan(-1);
    expect(webhookSource.slice(actionSuccess, actionReturn)).toContain("status: 'unknown'");
    expect(webhookSource.slice(actionSuccess, actionReturn)).not.toContain('complete_terminal_payment');
  });

  it('claims webhook events before processing and marks failure retryable', () => {
    expect(webhookSource).toContain("claim_stripe_terminal_webhook_event");
    expect(webhookSource).toContain("mark_stripe_terminal_webhook_failed");
    expect(completionMigration).toContain("status IN ('processing', 'processed', 'failed')");
    expect(completionMigration).toContain("status = 'failed'");
  });

  it('marks webhook events processed only after completion', () => {
    const completion = webhookSource.indexOf("db.rpc('complete_terminal_payment'");
    const processed = webhookSource.indexOf('await markProcessed(db, eventId)', completion);
    expect(completion).toBeGreaterThan(-1);
    expect(processed).toBeGreaterThan(completion);
  });

  it('preserves idempotent normal and split accounting completion', () => {
    expect(completionMigration).toContain('complete_accounting_card_payment');
    expect(completionMigration).toContain('finalize_split_card_payment');
    expect(completionMigration).toContain('Provider reference is already assigned to another order');
    expect(completionMigration).toContain('is_duplicate');
  });

  it('keeps the Android bridge path separate', () => {
    expect(retrieveSource).toContain('paymentRequestForBridge(req, payment_request_id)');
    expect(sharedSource).toContain('claimed_by_device_id');
  });

  it('keeps webhook JWT disabled while payment functions require JWT', () => {
    expect(webhookSource).toContain('validStripeSignature');
    expect(webhookSource).not.toContain('authenticatedUser');
  });

  it('does not fail a temporary requires_payment_method while the Reader action is active', () => {
    expect(retrieveSource).toContain("readerActionStatus === 'in_progress'");
    expect(retrieveSource).toContain('const status = processingStatus(request.status)');
    expect(retrieveSource).toContain("reader_action_status: 'in_progress'");
  });

  it('requires a confirmed Stripe or Reader failure before marking a decline', () => {
    expect(retrieveSource).toContain("const confirmedFailure = readerActionStatus === 'failed' || Boolean(intent.last_payment_error)");
    expect(retrieveSource).not.toContain("intent.status === 'requires_payment_method' && !['failed','succeeded'].includes(request.status)");
  });

  it('handles terminal.reader.action_failed as a real failed state', () => {
    expect(webhookSource).toContain("type === 'terminal.reader.action_failed'");
    expect(webhookSource).toContain("status: 'failed'");
    expect(webhookSource).toContain('readAndSyncReader(db, request, request.restaurant_payment_configs, false)');
  });

  it('completes succeeded PaymentIntents even when the request was previously failed', () => {
    expect(retrieveSource).toContain("if (intent.status === 'succeeded')");
    expect(retrieveSource).toContain("db.rpc('complete_terminal_payment'");
    expect(webhookSource).toContain("verified.status === 'succeeded'");
    expect(webhookSource).toContain("db.rpc('complete_terminal_payment'");
  });

  it('uses only valid webhook relationships and checks lookup errors', () => {
    expect(webhookSource).toContain("const paymentRequestSelect = '*, restaurant_payment_configs(provider_config)'");
    expect(webhookSource).not.toContain('stripe_terminal_readers(stripe_reader_id)');
    expect(webhookSource).toContain('if (error) throw error');
    expect(webhookSource).toContain(".eq('stripe_reader_id', request.stripe_reader_id)");
  });

  it('keeps failed webhook events retryable instead of processing them', () => {
    expect(webhookSource).toContain("mark_stripe_terminal_webhook_failed");
    expect(webhookSource).toContain("return new Response('Webhook handling failed', { status: 500 })");
    expect(webhookSource).toContain('async function markProcessed');
  });

  it('validates PaymentIntent metadata fallback against stored payment, order, store, and provider data', () => {
    expect(webhookSource).toContain('findValidatedMetadataFallback');
    expect(webhookSource).toContain("request.provider_type !== 'stripe_server_driven'");
    expect(webhookSource).toContain('request.stripe_payment_intent_id !== paymentIntentId');
    expect(webhookSource).toContain('request.order_id !== metadata.order_id');
    expect(webhookSource).toContain('order.store_id !== metadata.store_id');
  });

  it('clears the Reader action after trusted successful completion', () => {
    expect(completionMigration).toContain('action_status = \'idle\', action_type = NULL');
    expect(webhookSource).toContain("await markProcessed(db, eventId)");
  });

  it('keeps duplicate succeeded events idempotent', () => {
    expect(completionMigration).toContain('v_existing_payment');
    expect(completionMigration).toContain('provider_reference = p_provider_reference');
    expect(webhookSource).toContain('if (!claimed) return json({ received: true, duplicate: true })');
  });

  it('uses complete_terminal_payment for both polling and webhook reconciliation', () => {
    expect(retrieveSource).toContain("db.rpc('complete_terminal_payment'");
    expect(webhookSource).toContain("db.rpc('complete_terminal_payment'");
  });

  it('keeps the Android Bridge path unchanged', () => {
    expect(retrieveSource).toContain('paymentRequestForBridge(req, payment_request_id)');
    expect(sharedSource).toContain('claimed_by_device_id');
    expect(appSource).toContain("providerType === 'stripe_server_driven'");
  });

  it('keeps one card checkout attempt and one order creation path', () => {
    expect(appSource).toContain('if (checkoutInFlightRef.current) return;');
    expect(appSource).toContain("supabase.rpc('create_accounting_order'");
    expect(appSource).toContain("supabase.rpc('request_terminal_card_payment'");
  });

  it('deduplicates receipt jobs by order ID so trusted completion prints once', () => {
    expect(appSource).toContain('autoPrintJobsRef.current.get(orderKey)');
    expect(appSource).toContain('recordOrderReceiptPrinted(order.id)');
    expect(appSource).toContain('enqueueAutoReceiptPrint({ ...receiptOrder, status: \'completed\' })');
  });

  it('stores Stripe action IDs separately from the Stripe Reader ID', () => {
    expect(startSource).toContain('const actionId = action.action?.id');
    expect(startSource).not.toContain('reader_action_id: action.id');
    expect(retrySource).toContain('const actionId = action.action?.id');
    expect(retrySource).not.toContain('reader_action_id:action.id');
  });

  it('persists platform readers with a normalized null account scope', () => {
    expect(manageSource).toContain('normalizedStripeAccountId');
    expect(manageSource).toContain(".is('stripe_account_id', null)");
    expect(manageSource).toContain(".insert(payload).select().single()");
  });

  it('updates an existing platform reader by its internal UUID', () => {
    expect(manageSource).toContain(".eq('stripe_reader_id', stripeReaderId)");
    expect(manageSource).toContain(".eq('id', existing.id)");
    expect(manageSource).toContain(".eq('id', raced.id)");
  });

  it('scopes connected-account readers by stripe_account_id', () => {
    expect(manageSource).toContain(".eq('stripe_account_id', stripeAccountId)");
    expect(manageSource).not.toContain("onConflict: 'stripe_account_id,stripe_reader_id'");
  });

  it('recovers a racing insert from PostgreSQL unique violation 23505', () => {
    expect(manageSource).toContain("code === '23505'");
    expect(manageSource).toContain('const raced = await findNormalizedReader');
    expect(manageSource).toContain('const { data: updated, error: updateError }');
  });

  it('uses the same persistence path for register and attach_existing', () => {
    expect(manageSource).toContain("action === 'attach_existing'");
    expect(manageSource).toContain('const saved = await persistReader(db, payload)');
    expect(manageSource.match(/persistReader\(db, payload\)/g)).toHaveLength(1);
  });

  it('shows returned registration failures in Backoffice', () => {
    expect(integrationSource).toContain('data?.error || error?.message');
    expect(integrationSource).toContain('setReaderError(message)');
    expect(integrationSource).toContain('role="alert"');
  });

  it('prevents double-clicking Reader operations and shows registration loading state', () => {
    expect(integrationSource).toContain('readerBusyRef.current');
    expect(integrationSource).toContain("readerAction === 'register'");
    expect(integrationSource).toContain('disabled={readerBusy || !registrationCodeInput.trim()}');
  });

  it('leaves the Android Bridge path and provider state controls unchanged', () => {
    expect(integrationSource).toContain("'stripe_android_bridge'");
    expect(manageSource).not.toContain('set_active_terminal_provider');
    expect(manageSource).not.toContain("from('terminal_devices')");
  });
});
