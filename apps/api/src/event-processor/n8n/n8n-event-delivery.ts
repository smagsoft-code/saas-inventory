import { ALL_KNOWN_EVENT_TYPES, CURRENT_EVENT_VERSIONS } from '../../common/events/event-types';
import type { EventHandler } from '../event-delivery.port';
import type { N8nDeliveryConfig } from './n8n-delivery.config';
import { N8nWebhookClient } from './n8n-webhook.client';

/**
 * FASE 15 — builds the production delivery handlers that forward domain events to n8n (§18, §19).
 *
 * One explicit `EventHandler` per known event type, each pinned to that type's CURRENT contract
 * version — **no `sales.*` wildcard** (§19): a version the handler does not declare is dead-lettered
 * by `EventDispatcher` rather than delivered blind. As of FASE 15 this is exactly the 8 SALES
 * events at `eventVersion = 1`:
 *
 *   sales.order.confirmed          sales.price_approval.requested   sales.return.requested
 *   sales.order.cancelled          sales.price_approval.approved    sales.return.resolved
 *                                  sales.price_approval.rejected    sales.return.cancelled
 *
 * Every handler shares one `N8nWebhookClient` (one keep-alive HTTP path, one auth secret). The
 * handler does no domain lookups and no payload transformation — it posts the claimed envelope
 * verbatim (§26, §38).
 */
export function buildN8nEventHandlers(
  config: N8nDeliveryConfig,
  client: N8nWebhookClient = new N8nWebhookClient(config),
): EventHandler[] {
  return ALL_KNOWN_EVENT_TYPES.map((eventType) => ({
    eventType,
    eventVersion: CURRENT_EVENT_VERSIONS[eventType],
    deliver: (envelope) => client.post(envelope),
  }));
}
