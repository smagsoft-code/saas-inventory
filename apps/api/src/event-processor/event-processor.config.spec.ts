import { afterEach, describe, expect, it } from 'vitest';
import { assertValid, loadEventProcessorConfig, type EventProcessorConfig } from './event-processor.config';

const BASE: EventProcessorConfig = {
  pollIntervalMs: 2000,
  claimBatchSize: 50,
  staleClaimMs: 300_000,
  maxAttempts: 10,
  retryBaseMs: 1_000,
  retryMaxMs: 3_600_000,
  retryFactor: 2,
};

const KEYS = [
  'EVENT_PROCESSOR_POLL_INTERVAL_MS',
  'EVENT_PROCESSOR_CLAIM_BATCH_SIZE',
  'EVENT_PROCESSOR_STALE_CLAIM_MS',
  'EVENT_PROCESSOR_MAX_ATTEMPTS',
  'EVENT_PROCESSOR_RETRY_BASE_MS',
  'EVENT_PROCESSOR_RETRY_MAX_MS',
  'EVENT_PROCESSOR_RETRY_FACTOR',
];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('loadEventProcessorConfig', () => {
  it('returns the documented defaults when nothing is set', () => {
    expect(loadEventProcessorConfig()).toEqual(BASE);
  });

  it('reads overrides from the environment', () => {
    process.env['EVENT_PROCESSOR_CLAIM_BATCH_SIZE'] = '10';
    process.env['EVENT_PROCESSOR_MAX_ATTEMPTS'] = '3';
    const config = loadEventProcessorConfig();
    expect(config.claimBatchSize).toBe(10);
    expect(config.maxAttempts).toBe(3);
  });

  it('throws on a non-positive batch size (§163)', () => {
    process.env['EVENT_PROCESSOR_CLAIM_BATCH_SIZE'] = '0';
    expect(() => loadEventProcessorConfig()).toThrow(/CLAIM_BATCH_SIZE/);
  });

  it('throws when retryMaxMs < retryBaseMs', () => {
    process.env['EVENT_PROCESSOR_RETRY_BASE_MS'] = '5000';
    process.env['EVENT_PROCESSOR_RETRY_MAX_MS'] = '1000';
    expect(() => loadEventProcessorConfig()).toThrow(/RETRY_MAX_MS/);
  });
});

describe('assertValid', () => {
  it('accepts the defaults', () => {
    expect(() => assertValid(BASE)).not.toThrow();
  });

  it.each([
    ['pollIntervalMs', 0],
    ['maxAttempts', -1],
    ['staleClaimMs', 0],
    ['retryFactor', 0.5],
  ] as const)('rejects %s = %s', (key, value) => {
    expect(() => assertValid({ ...BASE, [key]: value })).toThrow();
  });
});
