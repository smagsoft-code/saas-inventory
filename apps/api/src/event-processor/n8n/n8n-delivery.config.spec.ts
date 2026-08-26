import { afterEach, describe, expect, it } from 'vitest';
import { assertValidN8nDeliveryConfig, loadN8nDeliveryConfig, type N8nDeliveryConfig } from './n8n-delivery.config';

const KEYS = ['N8N_EVENTS_ENABLED', 'N8N_EVENTS_WEBHOOK_URL', 'N8N_EVENTS_AUTH_TOKEN', 'N8N_EVENTS_TIMEOUT_MS', 'NODE_ENV'];

const VALID_TOKEN = 's3cret-token-abcdefghijklmnop';

function base(overrides: Partial<N8nDeliveryConfig> = {}): N8nDeliveryConfig {
  return {
    enabled: true,
    webhookUrl: 'https://n8n.example.com/webhook/saas-events',
    authToken: VALID_TOKEN,
    timeoutMs: 10_000,
    ...overrides,
  };
}

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('loadN8nDeliveryConfig (§70)', () => {
  it('defaults to disabled with no env set', () => {
    expect(loadN8nDeliveryConfig()).toEqual({ enabled: false, webhookUrl: '', authToken: '', timeoutMs: 10_000 });
  });

  it('does not validate URL/secret while disabled (§20)', () => {
    process.env['N8N_EVENTS_ENABLED'] = 'false';
    process.env['N8N_EVENTS_WEBHOOK_URL'] = 'not-a-url';
    expect(() => loadN8nDeliveryConfig()).not.toThrow();
  });

  it('reads a full enabled configuration', () => {
    process.env['N8N_EVENTS_ENABLED'] = 'true';
    process.env['N8N_EVENTS_WEBHOOK_URL'] = 'https://n8n.example.com/webhook/x';
    process.env['N8N_EVENTS_AUTH_TOKEN'] = VALID_TOKEN;
    process.env['N8N_EVENTS_TIMEOUT_MS'] = '5000';
    expect(loadN8nDeliveryConfig()).toEqual({
      enabled: true,
      webhookUrl: 'https://n8n.example.com/webhook/x',
      authToken: VALID_TOKEN,
      timeoutMs: 5000,
    });
  });

  it('throws when enabled but the URL is missing (fail closed, §21)', () => {
    process.env['N8N_EVENTS_ENABLED'] = 'true';
    process.env['N8N_EVENTS_AUTH_TOKEN'] = VALID_TOKEN;
    expect(() => loadN8nDeliveryConfig()).toThrow(/N8N_EVENTS_WEBHOOK_URL is required/);
  });

  it('throws when enabled but the auth token is missing (fail closed, §21)', () => {
    process.env['N8N_EVENTS_ENABLED'] = 'true';
    process.env['N8N_EVENTS_WEBHOOK_URL'] = 'https://n8n.example.com/webhook/x';
    expect(() => loadN8nDeliveryConfig()).toThrow(/N8N_EVENTS_AUTH_TOKEN is required/);
  });
});

describe('assertValidN8nDeliveryConfig (§70)', () => {
  it('accepts a valid enabled config', () => {
    expect(() => assertValidN8nDeliveryConfig(base())).not.toThrow();
  });

  it('accepts http://localhost in non-production (§23)', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'http://localhost:5678/webhook/x' }))).not.toThrow();
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'http://127.0.0.1:5678/webhook/x' }))).not.toThrow();
  });

  it('rejects http://localhost in production (§23)', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'http://localhost:5678/x' }))).toThrow(/https/);
  });

  it('rejects a remote http:// URL (§23)', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'http://n8n.example.com/webhook/x' }))).toThrow(/https/);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'ftp://n8n.example.com/x' }))).toThrow(/http\(s\)/);
  });

  it('rejects a URL with embedded credentials (§29)', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'https://user:pass@n8n.example.com/x' }))).toThrow(
      /must not embed credentials/,
    );
  });

  it('rejects an unparseable URL', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ webhookUrl: 'http://' }))).toThrow(/not a valid URL/);
  });

  it('rejects a trivially short secret (§119)', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ authToken: 'short' }))).toThrow(/at least 16/);
  });

  it('rejects a placeholder secret (§119)', () => {
    expect(() => assertValidN8nDeliveryConfig(base({ authToken: 'your-secret-here' }))).toThrow(/trivial placeholder/);
  });

  it.each([0, -1, 1.5, 999_999, Number.NaN])('rejects an invalid timeout %s (§30)', (timeoutMs) => {
    expect(() => assertValidN8nDeliveryConfig(base({ timeoutMs }))).toThrow(/N8N_EVENTS_TIMEOUT_MS/);
  });

  it('does nothing when disabled, whatever else is wrong (§20)', () => {
    expect(() =>
      assertValidN8nDeliveryConfig({ enabled: false, webhookUrl: '', authToken: '', timeoutMs: -5 }),
    ).not.toThrow();
  });
});
