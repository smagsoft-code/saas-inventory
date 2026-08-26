import { describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from '../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../common/events/event-types';
import { EventDispatcher } from './event-dispatcher.service';
import type { EventHandler } from './event-delivery.port';

function envelope(overrides: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope {
  return {
    eventId: '00000000-0000-7000-8000-000000000001',
    eventType: EVENT_TYPES.ORDER_CONFIRMED,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: '00000000-0000-7000-8000-0000000000aa',
    aggregateType: 'order',
    aggregateId: '00000000-0000-7000-8000-0000000000bb',
    correlationId: null,
    actor: { type: 'user', id: '00000000-0000-7000-8000-0000000000cc' },
    data: { orderId: 'o1' },
    ...overrides,
  };
}

function handler(eventType: string, eventVersion: number, deliver: EventHandler['deliver']): EventHandler {
  return { eventType, eventVersion, deliver };
}

describe('EventDispatcher', () => {
  it('reports the registered event types (drives the claim query filter)', () => {
    const d = new EventDispatcher([
      handler(EVENT_TYPES.ORDER_CONFIRMED, 1, vi.fn()),
      handler(EVENT_TYPES.ORDER_CANCELLED, 1, vi.fn()),
    ]);
    expect(d.supportedTypes().sort()).toEqual([EVENT_TYPES.ORDER_CANCELLED, EVENT_TYPES.ORDER_CONFIRMED].sort());
  });

  it('an empty registry supports nothing (FASE 14 production — §63/§119)', () => {
    expect(new EventDispatcher([]).supportedTypes()).toEqual([]);
  });

  it('rejects two handlers for the same type', () => {
    expect(() => new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, 1, vi.fn()), handler(EVENT_TYPES.ORDER_CONFIRMED, 1, vi.fn())])).toThrow();
  });

  it('delivers to the registered handler and reports success', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const d = new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, 1, deliver)]);
    const env = envelope();
    await expect(d.dispatch(env)).resolves.toEqual({ kind: 'delivered' });
    expect(deliver).toHaveBeenCalledWith(env);
  });

  it('a thrown handler error is a retry outcome, not terminal (§53/§65)', async () => {
    const d = new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, 1, vi.fn().mockRejectedValue(new Error('n8n down')))]);
    await expect(d.dispatch(envelope())).resolves.toEqual({ kind: 'retry', error: 'n8n down' });
  });

  it('an unsupported event version is terminal — retrying will not help (§157)', async () => {
    const d = new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, 2, vi.fn())]);
    const outcome = await d.dispatch(envelope({ eventVersion: 1 }));
    expect(outcome.kind).toBe('terminal');
  });

  it('a malformed envelope is terminal (§158)', async () => {
    const d = new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, 1, vi.fn())]);
    const outcome = await d.dispatch({ eventType: EVENT_TYPES.ORDER_CONFIRMED } as unknown as DomainEventEnvelope);
    expect(outcome.kind).toBe('terminal');
  });

  it('never a false success when no handler is registered (§61/§119)', async () => {
    const d = new EventDispatcher([]);
    const outcome = await d.dispatch(envelope());
    expect(outcome.kind).toBe('retry');
    expect(outcome.kind === 'retry' && outcome.error).toMatch(/no handler/);
  });
});
