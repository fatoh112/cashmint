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

  it('retry resolves a Stripe Reader ID, never a UUID column', () => {
    expect(retrySource).toContain(".eq('stripe_reader_id', request.stripe_reader_id)");
    expect(retrySource).not.toContain(".eq('id', request.stripe_reader_id)");
  });

  it('cancel resolves a Stripe Reader ID, never a UUID column', () => {
    expect(cancelSource).toContain(".eq('stripe_reader_id', request.stripe_reader_id)");
    expect(cancelSource).not.toContain(".eq('id', request.stripe_reader_id)");
  });

  it('retrieval uses the same trusted completion RPC as the webhook', () => {
    expect(retrieveSource).toContain("db.rpc('complete_terminal_payment'");
    expect(webhookSource).toContain("db.rpc('complete_terminal_payment'");
    expect(retrieveSource).not.toContain("update({status:'succeeded'");
    expect(webhookSource).not.toContain("update({ status:'succeeded'");
  });

  it('does not pay on Reader action success without PaymentIntent success', () => {
    const actionSuccess = webhookSource.indexOf("type === 'terminal.reader.action_succeeded'");
    const actionReturn = webhookSource.indexOf('return json({received:true})', actionSuccess);
    expect(actionSuccess).toBeGreaterThan(-1);
    expect(webhookSource.slice(actionSuccess, actionReturn)).toContain("status:'unknown'");
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
    const processed = webhookSource.indexOf("mark_stripe_terminal_webhook_processed", completion);
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
