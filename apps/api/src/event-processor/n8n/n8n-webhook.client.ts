import type { DomainEventEnvelope } from '../../common/events/domain-event.contracts';
import { sanitizeError } from '../error-sanitizer';
import type { N8nDeliveryConfig } from './n8n-delivery.config';
import { classifyHttpStatus, PermanentDeliveryError } from '../delivery-failure';

/** How much of an error response body to keep before sanitising/truncating (§36). */
const MAX_ERROR_BODY_CHARS = 800;

/**
 * FASE 15 — the single place the SaaS backend makes an outbound HTTP call to n8n (§25, §68, §69).
 * Runs only inside the Event Processor deployable, after the outbox row is claimed and committed —
 * never inside a business transaction, never from `OrdersService` / `ReturnsService` /
 * `PriceApprovalsService`.
 *
 * Uses the Node built-in `fetch` (Node 20+/undici) — no Axios / node-fetch dependency added (§25).
 *
 *  - `POST` the full v1 envelope as JSON, unchanged (§26, §28) — no domain lookups, no transforms.
 *  - `Authorization: Bearer <token>` from config; the token never appears in the body or the URL
 *    (§29). Non-secret traceability headers (`X-Event-*`) are added for n8n-side troubleshooting
 *    (§27) but the body stays canonical.
 *  - `AbortController` timeout → retryable failure (§30, §31).
 *  - `redirect: 'manual'` — a 3xx is never followed, so the bearer token is never resent to another
 *    host (§24); a redirect is treated as a permanent misconfiguration.
 *  - Only `2xx` is success (§32). Non-2xx is classified retryable vs permanent (§33, §34).
 *  - Error response bodies are sanitised + truncated before they can reach `last_error` / logs
 *    (§36, §37, §79).
 */
export class N8nWebhookClient {
  constructor(private readonly config: N8nDeliveryConfig) {}

  async post(envelope: DomainEventEnvelope): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.authToken}`,
      // §28: the SAME eventId is sent on every retry — it comes straight from the claimed row's
      // payload, this client never generates one.
      'x-event-id': envelope.eventId,
      'x-event-type': envelope.eventType,
      'x-event-version': String(envelope.eventVersion),
    };
    if (envelope.tenantId !== null) {
      headers['x-tenant-id'] = envelope.tenantId;
    }
    if (envelope.correlationId !== null) {
      headers['x-correlation-id'] = envelope.correlationId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers,
        body: JSON.stringify(envelope),
      });
    } catch (error) {
      // Network error, DNS failure, TLS error, or the abort timer fired — all retryable (§33, §73).
      const reason = controller.signal.aborted
        ? `request timed out after ${String(this.config.timeoutMs)}ms`
        : sanitizeError(error);
      throw new Error(`n8n delivery failed (retryable): ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    // `redirect: 'manual'` surfaces the 3xx (undici) or an opaqueredirect — never followed (§24).
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await drain(response);
      throw new PermanentDeliveryError(
        `n8n webhook responded with a redirect (HTTP ${String(response.status || 'opaque')}) — refusing to follow it and resend the auth token; fix N8N_EVENTS_WEBHOOK_URL (§24)`,
      );
    }

    if (response.status >= 200 && response.status < 300) {
      await drain(response);
      return;
    }

    const bodyExcerpt = sanitizeError(await readBodyExcerpt(response));
    const kind = classifyHttpStatus(response.status);
    const detail = `n8n returned HTTP ${String(response.status)}${bodyExcerpt ? ` — ${bodyExcerpt}` : ''}`;
    if (kind === 'permanent') {
      throw new PermanentDeliveryError(`${detail} (permanent — not retried, §34)`);
    }
    throw new Error(`n8n delivery failed (retryable): ${detail}`);
  }
}

async function readBodyExcerpt(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    return '';
  }
}

async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // nothing to free / already consumed — ignore.
  }
}
