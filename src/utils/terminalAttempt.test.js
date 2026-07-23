import { describe, expect, it, vi } from 'vitest';
import {
  createTerminalAttemptFinalizer,
  isFinalTerminalStatus,
  normalizeTerminalStatus,
} from './terminalAttempt';

describe('terminal attempt finalization', () => {
  it.each(['cancelled', 'canceled', 'failed', 'payment_intent.canceled'])('recognizes %s as final', (status) => {
    expect(isFinalTerminalStatus(status)).toBe(true);
  });

  it('normalizes Stripe canceled spelling for one final UI path', () => {
    expect(normalizeTerminalStatus('canceled')).toBe('cancelled');
    expect(normalizeTerminalStatus('payment_intent.canceled')).toBe('cancelled');
  });

  it('cleans polling, Realtime, loading, and result state exactly once', () => {
    const clearPolling = vi.fn();
    const removeRealtime = vi.fn();
    const resetState = vi.fn();
    const showResult = vi.fn();
    const finalizer = createTerminalAttemptFinalizer({
      paymentRequestId: 'attempt-1',
      isCurrentAttempt: (id) => id === 'attempt-1',
      clearPolling,
      removeRealtime,
      resetState,
      showResult,
    });

    expect(finalizer({ finalStatus: 'cancelled', message: 'Payment cancelled' })).toBe(true);
    expect(finalizer({ finalStatus: 'cancelled', message: 'Payment cancelled' })).toBe(false);
    expect(clearPolling).toHaveBeenCalledTimes(1);
    expect(removeRealtime).toHaveBeenCalledTimes(1);
    expect(resetState).toHaveBeenCalledTimes(1);
    expect(showResult).toHaveBeenCalledTimes(1);
  });

  it('ignores an old cancellation after a newer attempt starts', () => {
    let currentAttempt = 'attempt-2';
    const finalizer = createTerminalAttemptFinalizer({
      paymentRequestId: 'attempt-1',
      isCurrentAttempt: (id) => id === currentAttempt,
      clearPolling: vi.fn(),
      removeRealtime: vi.fn(),
      resetState: vi.fn(),
      showResult: vi.fn(),
    });

    expect(finalizer({ finalStatus: 'cancelled' })).toBe(false);
    currentAttempt = 'attempt-1';
    expect(finalizer({ finalStatus: 'cancelled' })).toBe(true);
  });
});
