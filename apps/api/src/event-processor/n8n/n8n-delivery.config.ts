import { getOptionalEnvVar } from '@saas-inventory/config';

/**
 * FASE 15 — configuration for the n8n event-delivery adapter (§20-§23, §70, §119, §141). Read from
 * the environment with the same `getOptionalEnvVar` + explicit-validation convention as
 * `EVENT_PROCESSOR_*` / `IMPORT_WORKER_*` — no new config subsystem. See `.env.example` and
 * `docs/integrations/n8n.md`.
 *
 * The secret (`N8N_EVENTS_AUTH_TOKEN`) is only ever used to build the `Authorization: Bearer`
 * header — never logged, never placed in the payload, never a query parameter (§29, §36, §37,
 * §97). The same value is configured as the webhook's Header Auth secret inside n8n.
 */
export interface N8nDeliveryConfig {
  /** When `false`, the Event Processor registers no n8n handler — events stay `pending` (§20). */
  enabled: boolean;
  /** The generic n8n events webhook. HTTPS in production; `http://localhost` only in dev/test (§23). */
  webhookUrl: string;
  /** Shared dedicated bearer secret. Runtime-only, from env/secrets (§10, §11). */
  authToken: string;
  /** Per-request timeout in milliseconds — a timeout is a retryable failure (§30, §31, §73). */
  timeoutMs: number;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Obvious non-secrets that must never be accepted when the adapter is enabled (§119). */
const TRIVIAL_TOKENS = new Set([
  'changeme',
  'change-me',
  'placeholder',
  'secret',
  'password',
  'token',
  'test',
  'example',
  'your-secret-here',
]);

const MIN_TOKEN_LENGTH = 16;
const MAX_TIMEOUT_MS = 120_000;

function isProduction(): boolean {
  return getOptionalEnvVar('NODE_ENV', 'development') === 'production';
}

export function loadN8nDeliveryConfig(): N8nDeliveryConfig {
  const config: N8nDeliveryConfig = {
    enabled: getOptionalEnvVar('N8N_EVENTS_ENABLED', 'false').toLowerCase() === 'true',
    webhookUrl: getOptionalEnvVar('N8N_EVENTS_WEBHOOK_URL', '').trim(),
    authToken: getOptionalEnvVar('N8N_EVENTS_AUTH_TOKEN', ''),
    timeoutMs: Number(getOptionalEnvVar('N8N_EVENTS_TIMEOUT_MS', '10000')),
  };
  assertValidN8nDeliveryConfig(config);
  return config;
}

/**
 * Fail closed (§21): if `N8N_EVENTS_ENABLED=true` but the URL/secret is missing or the URL is an
 * insecure remote endpoint, throw — the Event Processor must not start silently without being able
 * to deliver. When disabled, nothing else is validated (§20).
 */
export function assertValidN8nDeliveryConfig(config: N8nDeliveryConfig): void {
  if (!config.enabled) {
    return;
  }

  const problems: string[] = [];

  if (config.webhookUrl === '') {
    problems.push('N8N_EVENTS_WEBHOOK_URL is required when N8N_EVENTS_ENABLED=true');
  }
  if (config.authToken === '') {
    problems.push('N8N_EVENTS_AUTH_TOKEN is required when N8N_EVENTS_ENABLED=true');
  } else if (config.authToken.trim().length < MIN_TOKEN_LENGTH) {
    problems.push(`N8N_EVENTS_AUTH_TOKEN must be at least ${String(MIN_TOKEN_LENGTH)} characters`);
  } else if (TRIVIAL_TOKENS.has(config.authToken.trim().toLowerCase())) {
    problems.push('N8N_EVENTS_AUTH_TOKEN must not be a trivial placeholder value');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_TIMEOUT_MS) {
    problems.push(`N8N_EVENTS_TIMEOUT_MS must be an integer between 1 and ${String(MAX_TIMEOUT_MS)}`);
  }

  if (config.webhookUrl !== '') {
    let url: URL | undefined;
    try {
      url = new URL(config.webhookUrl);
    } catch {
      problems.push('N8N_EVENTS_WEBHOOK_URL is not a valid URL');
    }
    if (url) {
      const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
      if (url.protocol === 'http:') {
        if (!isLocal || isProduction()) {
          problems.push(
            'N8N_EVENTS_WEBHOOK_URL must use https:// — http:// is allowed only for localhost/127.0.0.1 in non-production (§23)',
          );
        }
      } else if (url.protocol !== 'https:') {
        problems.push('N8N_EVENTS_WEBHOOK_URL must be an http(s) URL');
      }
      if (url.username !== '' || url.password !== '') {
        problems.push('N8N_EVENTS_WEBHOOK_URL must not embed credentials — use N8N_EVENTS_AUTH_TOKEN (§29)');
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid n8n delivery configuration: ${problems.join('; ')}`);
  }
}
