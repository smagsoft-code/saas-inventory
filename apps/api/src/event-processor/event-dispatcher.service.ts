import { Inject, Injectable } from '@nestjs/common';
import type { DomainEventEnvelope } from '../common/events/domain-event.contracts';
import { isKnownEventType } from '../common/events/event-types';
import { EVENT_HANDLERS, type EventHandler } from './event-delivery.port';

/**
 * The outcome of trying to deliver one event:
 *  - `delivered`  — the registered handler returned success; mark the row `delivered` (§64).
 *  - `retry`      — a transient failure (handler threw); increment attempts, backoff, retry, and
 *                   dead-letter once `maxAttempts` is reached (§53, §65).
 *  - `terminal`   — the event can never be delivered by this processor as-is (unknown version,
 *                   malformed envelope, §157, §158); dead-letter it now — retrying won't help.
 */
export type DispatchOutcome =
  | { kind: 'delivered' }
  | { kind: 'retry'; error: string }
  | { kind: 'terminal'; error: string };

/**
 * Routes a claimed event to its registered handler (§59, §156). The registry is small and explicit
 * — a `Map<eventType, EventHandler>` built from the injected `EVENT_HANDLERS` array — no reflection
 * or auto-discovery.
 *
 * `supportedTypes()` is what the claim query filters on, so an event with no handler is never
 * claimed and can never become `delivered` (§63, §119). In FASE 14 the registry is empty in
 * production.
 */
@Injectable()
export class EventDispatcher {
  private readonly handlers = new Map<string, EventHandler>();

  constructor(@Inject(EVENT_HANDLERS) handlers: EventHandler[]) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.eventType)) {
        throw new Error(`More than one EventHandler registered for "${handler.eventType}"`);
      }
      this.handlers.set(handler.eventType, handler);
    }
  }

  supportedTypes(): string[] {
    return [...this.handlers.keys()];
  }

  async dispatch(envelope: DomainEventEnvelope): Promise<DispatchOutcome> {
    if (!isValidEnvelope(envelope)) {
      return { kind: 'terminal', error: 'malformed event envelope (missing eventId/eventType/eventVersion/data)' };
    }
    const handler = this.handlers.get(envelope.eventType);
    if (!handler) {
      // Unreachable while the claim query filters on supportedTypes(), but never a false success
      // if it does happen — and not terminal, a handler may be registered later (FASE 15).
      return { kind: 'retry', error: `no handler registered for event type "${envelope.eventType}"` };
    }
    if (handler.eventVersion !== envelope.eventVersion) {
      return {
        kind: 'terminal',
        error: `unsupported version ${String(envelope.eventVersion)} for "${envelope.eventType}" (handler expects v${String(handler.eventVersion)})`,
      };
    }
    try {
      await handler.deliver(envelope);
      return { kind: 'delivered' };
    } catch (error) {
      return { kind: 'retry', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function isValidEnvelope(value: unknown): value is DomainEventEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['eventId'] === 'string' &&
    typeof e['eventType'] === 'string' &&
    isKnownEventType(e['eventType']) &&
    typeof e['eventVersion'] === 'number' &&
    typeof e['data'] === 'object' &&
    e['data'] !== null
  );
}
