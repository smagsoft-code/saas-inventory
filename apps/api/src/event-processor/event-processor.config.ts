import { getOptionalEnvVar } from '@saas-inventory/config';

/**
 * Event Processor runtime configuration (§55, §163). Read from the environment following the same
 * `getOptionalEnvVar` + sensible-default convention as `IMPORT_WORKER_*` — see `.env.example`. No
 * new config subsystem.
 */
export interface EventProcessorConfig {
  /** How long to wait before the next poll when a poll claimed nothing (ms). */
  pollIntervalMs: number;
  /** Max rows claimed per poll (§87 — never load the whole table). */
  claimBatchSize: number;
  /** A row `processing` with `claimed_at` older than this is treated as abandoned by a crashed
   * worker and becomes reclaimable (§50, §51). */
  staleClaimMs: number;
  /** After this many processing attempts an event goes to the terminal `dead_letter` state
   * (§56, §116) — it is never deleted (§147). */
  maxAttempts: number;
  /** Exponential backoff: delay before retry N = min(retryMaxMs, retryBaseMs * retryFactor^N). */
  retryBaseMs: number;
  retryMaxMs: number;
  retryFactor: number;
}

function readInt(name: string, fallback: number): number {
  const value = Number(getOptionalEnvVar(name, String(fallback)));
  return value;
}

export function loadEventProcessorConfig(): EventProcessorConfig {
  const config: EventProcessorConfig = {
    pollIntervalMs: readInt('EVENT_PROCESSOR_POLL_INTERVAL_MS', 2000),
    claimBatchSize: readInt('EVENT_PROCESSOR_CLAIM_BATCH_SIZE', 50),
    staleClaimMs: readInt('EVENT_PROCESSOR_STALE_CLAIM_MS', 300_000),
    maxAttempts: readInt('EVENT_PROCESSOR_MAX_ATTEMPTS', 10),
    retryBaseMs: readInt('EVENT_PROCESSOR_RETRY_BASE_MS', 1_000),
    retryMaxMs: readInt('EVENT_PROCESSOR_RETRY_MAX_MS', 3_600_000),
    retryFactor: readInt('EVENT_PROCESSOR_RETRY_FACTOR', 2),
  };
  assertValid(config);
  return config;
}

/** §163 — reject a misconfigured processor loudly at startup rather than behaving strangely. */
export function assertValid(config: EventProcessorConfig): void {
  const problems: string[] = [];
  if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < 1) problems.push('EVENT_PROCESSOR_POLL_INTERVAL_MS must be >= 1');
  if (!Number.isInteger(config.claimBatchSize) || config.claimBatchSize < 1) problems.push('EVENT_PROCESSOR_CLAIM_BATCH_SIZE must be a positive integer');
  if (!Number.isFinite(config.staleClaimMs) || config.staleClaimMs < 1) problems.push('EVENT_PROCESSOR_STALE_CLAIM_MS must be >= 1');
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) problems.push('EVENT_PROCESSOR_MAX_ATTEMPTS must be a positive integer');
  if (!Number.isFinite(config.retryBaseMs) || config.retryBaseMs < 1) problems.push('EVENT_PROCESSOR_RETRY_BASE_MS must be >= 1');
  if (!Number.isFinite(config.retryMaxMs) || config.retryMaxMs < config.retryBaseMs) problems.push('EVENT_PROCESSOR_RETRY_MAX_MS must be >= EVENT_PROCESSOR_RETRY_BASE_MS');
  if (!Number.isFinite(config.retryFactor) || config.retryFactor < 1) problems.push('EVENT_PROCESSOR_RETRY_FACTOR must be >= 1');
  if (problems.length > 0) {
    throw new Error(`Invalid Event Processor configuration: ${problems.join('; ')}`);
  }
}
