import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from '../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../common/events/event-types';
import type { ClaimedEvent } from './event-claim.repository';
import { EventProcessorService } from './event-processor.service';

// getEventProcessorDb() lazily builds a postgres-js client — it never connects until a query runs,
// and every claim/mark call in these tests goes through the mocked repository below, so a bogus URL
// is enough to get past the getRequiredEnvVar check.
process.env['APP_EVENT_PROCESSOR_DATABASE_URL'] ??= 'postgresql://u:p@127.0.0.1:1/none';

function claimed(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    tenantId: '00000000-0000-7000-8000-0000000000aa',
    eventType: EVENT_TYPES.ORDER_CONFIRMED,
    attempts: 0,
    createdAt: new Date(),
    payload: { eventId: 'e1', eventType: EVENT_TYPES.ORDER_CONFIRMED, eventVersion: 1, data: {} } as DomainEventEnvelope,
    ...overrides,
  };
}

function build(supportedTypes: string[]) {
  const claimRepository = {
    reapStale: vi.fn().mockResolvedValue(0),
    claimBatch: vi.fn().mockResolvedValue([]),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markTerminal: vi.fn().mockResolvedValue(undefined),
  };
  const dispatcher = {
    supportedTypes: vi.fn().mockReturnValue(supportedTypes),
    dispatch: vi.fn(),
  };
  const service = new EventProcessorService(claimRepository as never, dispatcher as never);
  return { service, claimRepository, dispatcher };
}

describe('EventProcessorService.runOnce', () => {
  beforeEach(() => vi.clearAllMocks());

  it('with no registered handler: completely idle — never claims, never even reaps (§61/§63/§119)', async () => {
    const { service, claimRepository } = build([]);
    const count = await service.runOnce('w1');
    expect(count).toBe(0);
    expect(claimRepository.reapStale).not.toHaveBeenCalled();
    expect(claimRepository.claimBatch).not.toHaveBeenCalled();
  });

  it('with a registered handler: reaps stale rows before claiming', async () => {
    const { service, claimRepository } = build([EVENT_TYPES.ORDER_CONFIRMED]);
    await service.runOnce('w1');
    expect(claimRepository.reapStale).toHaveBeenCalledOnce();
    expect(claimRepository.claimBatch).toHaveBeenCalledOnce();
  });

  it('marks an event delivered only when the dispatcher returns success (§64)', async () => {
    const { service, claimRepository, dispatcher } = build([EVENT_TYPES.ORDER_CONFIRMED]);
    claimRepository.claimBatch.mockResolvedValue([claimed()]);
    dispatcher.dispatch.mockResolvedValue({ kind: 'delivered' });
    await service.runOnce('w1');
    expect(claimRepository.markDelivered).toHaveBeenCalledWith(expect.anything(), claimed().id);
    expect(claimRepository.markFailed).not.toHaveBeenCalled();
  });

  it('a retry outcome calls markFailed with the sanitized error, never markDelivered (§65)', async () => {
    const { service, claimRepository, dispatcher } = build([EVENT_TYPES.ORDER_CONFIRMED]);
    claimRepository.claimBatch.mockResolvedValue([claimed()]);
    dispatcher.dispatch.mockResolvedValue({ kind: 'retry', error: 'boom token=secret' });
    await service.runOnce('w1');
    expect(claimRepository.markDelivered).not.toHaveBeenCalled();
    const [, , error, maxAttempts] = claimRepository.markFailed.mock.calls[0]!;
    expect(error).not.toContain('secret');
    expect(maxAttempts).toBe(10);
  });

  it('a terminal outcome dead-letters the event immediately (§157/§158)', async () => {
    const { service, claimRepository, dispatcher } = build([EVENT_TYPES.ORDER_CONFIRMED]);
    claimRepository.claimBatch.mockResolvedValue([claimed()]);
    dispatcher.dispatch.mockResolvedValue({ kind: 'terminal', error: 'unknown version' });
    await service.runOnce('w1');
    expect(claimRepository.markTerminal).toHaveBeenCalledOnce();
    expect(claimRepository.markFailed).not.toHaveBeenCalled();
  });

  it('one failing event never aborts the rest of the batch (§57)', async () => {
    const { service, claimRepository, dispatcher } = build([EVENT_TYPES.ORDER_CONFIRMED]);
    claimRepository.claimBatch.mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b' })]);
    dispatcher.dispatch.mockImplementationOnce(() => {
      throw new Error('dispatcher exploded');
    }).mockResolvedValueOnce({ kind: 'delivered' });
    const count = await service.runOnce('w1');
    expect(count).toBe(2);
    expect(claimRepository.markDelivered).toHaveBeenCalledWith(expect.anything(), 'b');
  });
});
