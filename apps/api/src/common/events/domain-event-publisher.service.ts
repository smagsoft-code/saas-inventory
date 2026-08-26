import { Injectable } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { TenantTransaction } from '../../database/tenant-context';
import type { DomainEventEnvelope, DomainEventInput } from './domain-event.contracts';
import { CURRENT_EVENT_VERSIONS } from './event-types';
import { OutboxRepository } from './outbox.repository';

/** `event_outbox.correlation_id` is a `uuid` column; a request's `Correlation-Id` header can be an
 * arbitrary client string (main.ts's hook does not validate it). Same rule as AuditLogService:
 * store it only when it is actually UUID-shaped, so a garbage header can never turn a business
 * operation into a failed INSERT. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The transactional-outbox write API (events.md, ADR-0010, §79). A producer service calls
 * `append(tx, input)` inside its existing `withTenantTransaction` — the `event_outbox` row and the
 * business mutation commit or roll back atomically (§26, §27, §40).
 *
 * **Not best-effort.** Unlike `AuditLogService.record` (which callers wrap in `try/catch`), a
 * failure here throws and MUST propagate so the caller's transaction rolls back (§27, §80, §153) —
 * "business committed, event lost" would violate the outbox contract.
 *
 * Provided into each producer module's `providers` array exactly the way `AuditLogService` is —
 * never via a module-to-module import — so there is no `SALES -> NOTIFICATIONS` dependency and no
 * circular dependency (§24). The Event Processor (`apps/api/src/event-processor/`) is the only
 * component that reads these rows back.
 */
@Injectable()
export class DomainEventPublisher {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async append<TData>(tx: TenantTransaction, input: DomainEventInput<TData>): Promise<void> {
    const envelope: DomainEventEnvelope<TData> = {
      eventId: generateId(),
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? CURRENT_EVENT_VERSIONS[input.eventType],
      occurredAt: new Date().toISOString(),
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId: normaliseCorrelationId(input.correlationId),
      actor: input.actor,
      data: input.data,
    };
    await this.outboxRepository.append(tx, envelope as DomainEventEnvelope);
  }
}

function normaliseCorrelationId(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && UUID_PATTERN.test(value) ? value : null;
}
