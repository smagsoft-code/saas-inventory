import type { EventProcessorConfig } from './event-processor.config';

/**
 * Exponential backoff with a capped ceiling (§54, events.md#idempotency-and-retries):
 *
 *     delay(attempts) = min(retryMaxMs, retryBaseMs * retryFactor^attempts)
 *
 * `attempts` is the number of failed attempts SO FAR (0 → first retry uses the base delay). This
 * pure function is unit-tested and used for log lines; the Event Processor's claim query
 * (`event-claim.repository.ts`) computes the SAME formula in SQL because the per-row `attempts`
 * value is only known there. The two MUST stay in sync — change both together.
 */
export function nextRetryDelayMs(attempts: number, config: EventProcessorConfig): number {
  const safeAttempts = Math.max(0, Math.floor(attempts));
  const raw = config.retryBaseMs * Math.pow(config.retryFactor, safeAttempts);
  return Math.round(Math.min(config.retryMaxMs, raw));
}
