import { describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from '../../common/events/domain-event.contracts';
import { ALL_KNOWN_EVENT_TYPES, EVENT_TYPES } from '../../common/events/event-types';
import { EventDispatcher } from '../event-dispatcher.service';
import type { N8nDeliveryConfig } from './n8n-delivery.config';
import { buildN8nEventHandlers } from './n8n-event-delivery';
import { N8nWebhookClient } from './n8n-webhook.client';
import { PermanentDeliveryError } from '../delivery-failure';

const CONFIG: N8nDeliveryConfig = {
  enabled: true,
  webhookUrl: 'https://n8n.example.com/webhook/x',
  authToken: 's3cret-token-abcdefghijklmnop',
  timeoutMs: 10_000,
};

function envelope(eventType: string): DomainEventEnvelope {
  return {
    eventId: `id-${eventType}`,
    eventType: eventType as DomainEventEnvelope['eventType'],
    eventVersion: 1,
    occurredAt: '2026-08-26T10:00:00.000Z',
    tenantId: 't-1',
    aggregateType: 'order',
    aggregateId: 'agg-1',
    correlationId: null,
    actor: { type: 'user', id: 'u-1' },
    data: {},
  };
}

describe('buildN8nEventHandlers (§18/§19/§85)', () => {
  it('registers exactly the 8 known event types, each at version 1, no wildcard', () => {
    const handlers = buildN8nEventHandlers(CONFIG, { post: vi.fn() } as unknown as N8nWebhookClient);
    expect(handlers.map((h) => h.eventType).sort()).toEqual([...ALL_KNOWN_EVENT_TYPES].sort());
    expect(handlers.every((h) => h.eventVersion === 1)).toBe(true);
    expect(handlers.some((h) => h.eventType.includes('*'))).toBe(false);
  });

  it("the dispatcher's supportedTypes() are the 8 SALES events (§85)", () => {
    const dispatcher = new EventDispatcher(
      buildN8nEventHandlers(CONFIG, { post: vi.fn() } as unknown as N8nWebhookClient),
    );
    expect(dispatcher.supportedTypes().sort()).toEqual(
      [
        'sales.order.cancelled',
        'sales.order.confirmed',
        'sales.price_approval.approved',
        'sales.price_approval.rejected',
        'sales.price_approval.requested',
        'sales.return.cancelled',
        'sales.return.requested',
        'sales.return.resolved',
      ].sort(),
    );
  });

  it('each handler forwards the untransformed envelope to the shared client (§26/§38)', async () => {
    const post = vi.fn<(e: DomainEventEnvelope) => Promise<void>>().mockResolvedValue();
    const handlers = buildN8nEventHandlers(CONFIG, { post } as unknown as N8nWebhookClient);
    const confirmed = handlers.find((h) => h.eventType === EVENT_TYPES.ORDER_CONFIRMED);
    const env = envelope(EVENT_TYPES.ORDER_CONFIRMED);
    await confirmed?.deliver(env);
    expect(post).toHaveBeenCalledWith(env);
  });

  it('a permanent client error becomes a terminal dispatch outcome (§34/§126)', async () => {
    const post = vi.fn().mockRejectedValue(new PermanentDeliveryError('n8n returned HTTP 401 (permanent)'));
    const dispatcher = new EventDispatcher(buildN8nEventHandlers(CONFIG, { post } as unknown as N8nWebhookClient));
    const outcome = await dispatcher.dispatch(envelope(EVENT_TYPES.ORDER_CONFIRMED));
    expect(outcome.kind).toBe('terminal');
  });

  it('a transient client error becomes a retry dispatch outcome (§33)', async () => {
    const post = vi.fn().mockRejectedValue(new Error('n8n delivery failed (retryable): HTTP 503'));
    const dispatcher = new EventDispatcher(buildN8nEventHandlers(CONFIG, { post } as unknown as N8nWebhookClient));
    const outcome = await dispatcher.dispatch(envelope(EVENT_TYPES.ORDER_CONFIRMED));
    expect(outcome.kind).toBe('retry');
  });

  it('an unknown future version for a registered type is dead-lettered, not delivered (§65)', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new EventDispatcher(buildN8nEventHandlers(CONFIG, { post } as unknown as N8nWebhookClient));
    const outcome = await dispatcher.dispatch({ ...envelope(EVENT_TYPES.ORDER_CONFIRMED), eventVersion: 2 });
    expect(outcome.kind).toBe('terminal');
    expect(post).not.toHaveBeenCalled();
  });
});
