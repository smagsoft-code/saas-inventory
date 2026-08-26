/**
 * FASE 15 — classification of an n8n delivery failure into exactly two buckets (§33, §34, §126):
 *
 *  - `retryable`  — a transient condition; the Event Processor's existing exponential-backoff /
 *                   `maxAttempts` / `dead_letter` machinery applies unchanged (§35, §67).
 *  - `permanent`  — a contract / configuration / auth error that will not improve with retries;
 *                   the event is dead-lettered immediately in a controlled way (§34, §77, §78).
 *
 * The adapter signals `permanent` by throwing `PermanentDeliveryError`; anything else it throws is
 * treated by `EventDispatcher` as `retryable` (the FASE 14 default for a handler that throws).
 */
export class PermanentDeliveryError extends Error {
  readonly permanent = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

export function isPermanentDeliveryError(error: unknown): error is PermanentDeliveryError {
  return (
    error instanceof PermanentDeliveryError ||
    (typeof error === 'object' && error !== null && (error as { permanent?: unknown }).permanent === true)
  );
}

export type DeliveryFailureKind = 'retryable' | 'permanent';

/** Retryable non-2xx statuses: transient server / rate-limit / early-hints conditions (§33). */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/**
 * Classify a non-2xx HTTP response status. 5xx is retryable (the server may recover); a 3xx that
 * somehow reached here is a misconfiguration and permanent (we use `redirect: 'manual'` and never
 * follow — §24); every other 4xx (400/401/403/404/405/410/422/…) is a permanent
 * contract/auth/config error (§34).
 */
export function classifyHttpStatus(status: number): DeliveryFailureKind {
  if (RETRYABLE_STATUSES.has(status)) {
    return 'retryable';
  }
  if (status >= 500 && status <= 599) {
    return 'retryable';
  }
  return 'permanent';
}
