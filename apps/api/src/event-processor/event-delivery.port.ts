import type { DomainEventEnvelope } from '../common/events/domain-event.contracts';

/**
 * The delivery abstraction between the Event Processor and whatever actually forwards an event to
 * the outside world (§59, §159, §63). FASE 15 implements an n8n-webhook adapter against this
 * interface; FASE 14 registers **no** production handler (§60, §61) — the delivery port exists,
 * ready, but empty, so nothing is ever falsely marked delivered before FASE 15 (§119).
 *
 * A handler is bound to one `eventType` at one `eventVersion`. `deliver` throws on any
 * failure/timeout — the dispatcher treats a thrown error as a retryable delivery failure
 * (backoff + eventual dead-letter), and a version it does not recognise as terminal.
 */
export interface EventHandler {
  readonly eventType: string;
  readonly eventVersion: number;
  deliver(envelope: DomainEventEnvelope): Promise<void>;
}

/** Multi-provider DI token. `EventProcessorModule` binds it to `[]` in production; a test overrides
 * it with in-memory fakes. */
export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');
