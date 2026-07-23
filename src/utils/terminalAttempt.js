export const FINAL_TERMINAL_STATUSES = new Set([
  'cancelled',
  'canceled',
  'failed',
  'payment_intent.canceled',
  'expired',
]);

export function normalizeTerminalStatus(status) {
  if (status === 'canceled' || status === 'payment_intent.canceled') return 'cancelled';
  return status;
}

export function isFinalTerminalStatus(status) {
  return FINAL_TERMINAL_STATUSES.has(status);
}

export function createTerminalAttemptFinalizer({
  paymentRequestId,
  isCurrentAttempt,
  clearPolling,
  removeRealtime,
  resetState,
  showResult,
}) {
  let finalized = false;

  return (result) => {
    if (finalized || !isCurrentAttempt(paymentRequestId)) return false;
    finalized = true;
    clearPolling();
    removeRealtime();
    resetState(result);
    showResult(result);
    return true;
  };
}
