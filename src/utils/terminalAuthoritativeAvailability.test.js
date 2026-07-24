import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const availabilitySource = readFileSync(new URL('../../supabase/functions/terminal-payment-availability/index.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const recoveryMigration = readFileSync(new URL('../../supabase/migrations/20260724132014_terminal_recovery_lease.sql', import.meta.url), 'utf8');

describe('authoritative WisePOS E availability and recovery guards', () => {
  it('returns READER_OFFLINE for an offline Reader', () => expect(availabilitySource).toContain("reason = 'READER_OFFLINE'"));
  it('reconciles an idle stale DB request', () => expect(availabilitySource).toContain('recoverStaleRequest'));
  it('reports active matching Reader actions as busy', () => expect(availabilitySource).toContain("'READER_BUSY'"));
  it('does not block forever on old requests', () => expect(availabilitySource).toContain("status: 'expired'"));
  it('never expires a succeeded PaymentIntent', () => expect(availabilitySource).toContain("intent.status === 'succeeded'"));
  it('performs the offline check before creating a card order', () => expect(appSource).toContain("supabase.functions.invoke('terminal-payment-availability'"));
  it('keeps the cart on preflight failure', () => expect(appSource).toContain('terminalAvailabilityMessage(availability?.reason, isArabic)'));
  it('supports a retry connection check', () => expect(appSource).toContain('Retry connection check'));
  it('guards repeated clicks with the checkout in-flight ref', () => expect(appSource).toContain('checkoutInFlightRef.current'));
  it('contains exact English offline and busy messages', () => {
    expect(appSource).toContain('WisePOS E is offline. Check that the device is powered on and connected to the internet.');
    expect(appSource).toContain('WisePOS E is processing another payment.');
  });
  it('preserves the normal trusted completion path', () => expect(availabilitySource).toContain("db.rpc('complete_terminal_payment'"));
  it('preserves split recovery synchronization', () => expect(availabilitySource).toContain("db.rpc('sync_terminal_split_card_failure'"));
  it('does not alter Manual Sale provider selection', () => expect(appSource).toContain('create_manual_card_sale'));
  it('leaves cash checkout independent of terminal preflight', () => expect(appSource).toContain("paymentMethod === 'card'"));
  it('does not enable Android Bridge', () => expect(appSource).not.toContain('set_active_terminal_provider'));
  it('prints only through the existing verified success flow', () => expect(appSource).toContain('enqueueAutoReceiptPrint'));
  it('re-reads after cancellation failure', () => expect(availabilitySource).toContain('cancellationError'));
  it('preserves processing PaymentIntents', () => expect(availabilitySource).toContain("['processing', 'requires_capture']"));
  it('preserves requires_capture PaymentIntents', () => expect(availabilitySource).toContain("payment_intent_status: intent.status"));
  it('guards overlapping recovery calls with a lease RPC', () => {
    expect(availabilitySource).toContain("claim_terminal_payment_recovery");
    expect(recoveryMigration).toContain('recovery_claimed_at');
  });
  it('does not recover every stale row in one poll', () => expect(availabilitySource).toContain('const staleCandidate'));
  it('returns recovery failures as safe results', () => expect(availabilitySource).toContain("result: 'RECOVERY_FAILED'"));
  it('expires only after Stripe confirms canceled', () => expect(availabilitySource).toContain("intent.status !== 'canceled'"));
  it('keeps the webhook as the financial authority', () => expect(appSource).toContain('retrieve-terminal-payment-status'));
});
