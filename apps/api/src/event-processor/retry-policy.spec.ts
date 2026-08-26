import { describe, expect, it } from 'vitest';
import type { EventProcessorConfig } from './event-processor.config';
import { nextRetryDelayMs } from './retry-policy';

const CONFIG: EventProcessorConfig = {
  pollIntervalMs: 2000,
  claimBatchSize: 50,
  staleClaimMs: 300_000,
  maxAttempts: 10,
  retryBaseMs: 1_000,
  retryMaxMs: 60_000,
  retryFactor: 2,
};

describe('nextRetryDelayMs', () => {
  it('is the base delay for the first retry (attempts = 0)', () => {
    expect(nextRetryDelayMs(0, CONFIG)).toBe(1_000);
  });

  it('doubles per attempt with retryFactor = 2', () => {
    expect(nextRetryDelayMs(1, CONFIG)).toBe(2_000);
    expect(nextRetryDelayMs(2, CONFIG)).toBe(4_000);
    expect(nextRetryDelayMs(3, CONFIG)).toBe(8_000);
  });

  it('is capped at retryMaxMs', () => {
    expect(nextRetryDelayMs(100, CONFIG)).toBe(60_000);
  });

  it('never goes below the base delay for negative / non-integer input', () => {
    expect(nextRetryDelayMs(-5, CONFIG)).toBe(1_000);
    expect(nextRetryDelayMs(1.9, CONFIG)).toBe(2_000);
  });
});
