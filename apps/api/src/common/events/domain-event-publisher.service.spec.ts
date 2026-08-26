import { describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from './domain-event.contracts';
import { DomainEventPublisher } from './domain-event-publisher.service';
import { EVENT_TYPES } from './event-types';

function build() {
  const captured: DomainEventEnvelope[] = [];
  const outboxRepository = {
    append: vi.fn(async (_tx: unknown, envelope: DomainEventEnvelope) => {
      captured.push(envelope);
    }),
  };
  const publisher = new DomainEventPublisher(outboxRepository as never);
  return { publisher, outboxRepository, captured };
}

const TX = {} as never;
const UUID = '00000000-0000-7000-8000-00000000abcd';

describe('DomainEventPublisher.append', () => {
  it('builds a complete envelope: fresh eventId, ISO occurredAt, default version, passthrough fields', async () => {
    const { publisher, captured } = build();
    await publisher.append(TX, {
      eventType: EVENT_TYPES.ORDER_CONFIRMED,
      tenantId: UUID,
      aggregateType: 'order',
      aggregateId: UUID,
      correlationId: UUID,
      actor: { type: 'user', id: UUID },
      data: { orderId: 'o1' },
    });
    const env = captured[0]!;
    expect(env.eventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(env.eventType).toBe(EVENT_TYPES.ORDER_CONFIRMED);
    expect(env.eventVersion).toBe(1);
    expect(Number.isNaN(Date.parse(env.occurredAt))).toBe(false);
    expect(env.tenantId).toBe(UUID);
    expect(env.aggregateType).toBe('order');
    expect(env.correlationId).toBe(UUID);
    expect(env.actor).toEqual({ type: 'user', id: UUID });
    expect(env.data).toEqual({ orderId: 'o1' });
  });

  it('generates a distinct eventId on every call (§21 — never reused)', async () => {
    const { publisher, captured } = build();
    const input = {
      eventType: EVENT_TYPES.ORDER_CANCELLED,
      tenantId: UUID,
      aggregateType: 'order' as const,
      aggregateId: UUID,
      actor: { type: 'user' as const, id: UUID },
      data: {},
    };
    await publisher.append(TX, input);
    await publisher.append(TX, input);
    expect(captured[0]!.eventId).not.toBe(captured[1]!.eventId);
  });

  it('nulls a non-UUID correlation id (uuid column safety, like AuditLogService)', async () => {
    const { publisher, captured } = build();
    await publisher.append(TX, {
      eventType: EVENT_TYPES.ORDER_CONFIRMED,
      tenantId: UUID,
      aggregateType: 'order',
      aggregateId: UUID,
      correlationId: 'not-a-uuid',
      actor: { type: 'user', id: UUID },
      data: {},
    });
    expect(captured[0]!.correlationId).toBeNull();
  });

  it('propagates an outbox failure — NOT best-effort (§27/§80)', async () => {
    const { publisher, outboxRepository } = build();
    outboxRepository.append.mockRejectedValueOnce(new Error('constraint violation'));
    await expect(
      publisher.append(TX, {
        eventType: EVENT_TYPES.ORDER_CONFIRMED,
        tenantId: UUID,
        aggregateType: 'order',
        aggregateId: UUID,
        actor: { type: 'user', id: UUID },
        data: {},
      }),
    ).rejects.toThrow('constraint violation');
  });
});
