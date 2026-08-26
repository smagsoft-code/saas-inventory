import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DomainEventEnvelope } from '../common/events/domain-event.contracts';
import type { EventProcessorDatabase } from '../database/event-processor-client';
import type { EventProcessorConfig } from './event-processor.config';

export interface ClaimedEvent {
  id: string;
  tenantId: string | null;
  eventType: string;
  /** Post-claim attempt count (a stale reclaim increments it; a fresh `pending` claim does not). */
  attempts: number;
  createdAt: Date;
  payload: DomainEventEnvelope;
}

type ClaimRow = {
  id: string;
  tenant_id: string | null;
  event_type: string;
  attempts: number;
  created_at: Date;
  payload: DomainEventEnvelope;
};

/**
 * The Event Processor's claim + mark queries — the `event_outbox` equivalent of
 * `ImportWorkerClaimRepository` (ADR-0029: same `FOR UPDATE SKIP LOCKED` mechanism, different table,
 * different DB role, separate repository — never shared with the Import Worker). Runs over the
 * dedicated `app_event_processor` connection (`event-processor-client.ts`), which the
 * `event_outbox_event_processor_access` policy (migration 0010) lets read/write across every tenant
 * in one query.
 *
 * The claim is a single atomic statement (CTE + `FOR UPDATE SKIP LOCKED` → `UPDATE ... RETURNING`),
 * so two concurrent Event Processor instances never claim the same row (§46, §47, §70, §111). The
 * transaction is short — dispatch (and, from FASE 15, the external webhook call) happens *after*
 * the claim commits, never with the row lock held (§48).
 */
@Injectable()
export class EventClaimRepository {
  /**
   * Claim up to `config.claimBatchSize` events whose type has a registered handler
   * (`supportedTypes` — empty in FASE 14 production, so this claims nothing and no event is ever
   * falsely delivered, §63/§119). A row is claimable when:
   *  - it is `pending` and either never attempted, or its backoff window
   *    (`min(retryMaxMs, retryBaseMs * retryFactor^attempts)`) has elapsed since the last attempt
   *    (`claimed_at` doubles as the last-attempt timestamp — no schema column needed), OR
   *  - it is `processing` but its claim is stale (`claimed_at` older than `staleClaimMs`) — a
   *    worker that claimed it then died (§50, §51); reclaiming increments `attempts`.
   *  - and `attempts < maxAttempts` in both cases.
   */
  async claimBatch(
    db: EventProcessorDatabase,
    workerId: string,
    supportedTypes: string[],
    config: EventProcessorConfig,
  ): Promise<ClaimedEvent[]> {
    if (supportedTypes.length === 0) {
      return [];
    }
    const typesArray = sql.join(
      supportedTypes.map((t) => sql`${t}`),
      sql`, `,
    );
    const rows = await db.execute<ClaimRow>(sql`
      WITH claimable AS (
        SELECT id, status
        FROM event_outbox
        WHERE event_type = ANY(ARRAY[${typesArray}]::text[])
          AND attempts < ${config.maxAttempts}
          AND (
            (
              status = 'pending'
              AND (
                claimed_at IS NULL
                OR claimed_at < now() - (
                  LEAST(
                    ${config.retryMaxMs}::double precision,
                    ${config.retryBaseMs}::double precision * power(${config.retryFactor}::double precision, attempts)
                  ) * interval '1 millisecond'
                )
              )
            )
            OR (
              status = 'processing'
              AND claimed_at < now() - (${config.staleClaimMs}::double precision * interval '1 millisecond')
            )
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${config.claimBatchSize}
      )
      UPDATE event_outbox e
      SET status = 'processing',
          claimed_at = now(),
          claimed_by = ${workerId},
          attempts = e.attempts + (CASE WHEN c.status = 'processing' THEN 1 ELSE 0 END)
      FROM claimable c
      WHERE e.id = c.id
      RETURNING e.id, e.tenant_id, e.event_type, e.attempts, e.created_at, e.payload
    `);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      attempts: Number(row.attempts),
      createdAt: row.created_at,
      payload: row.payload,
    }));
  }

  /** Handler returned success — the only path to a terminal `delivered` state (§64). Guarded on
   * `status = 'processing'` so a late second worker (crash-window redelivery) is a harmless no-op. */
  async markDelivered(db: EventProcessorDatabase, id: string): Promise<void> {
    await db.execute(sql`
      UPDATE event_outbox
      SET status = 'delivered', processed_at = now(), last_error = NULL
      WHERE id = ${id} AND status = 'processing'
    `);
  }

  /** Transient failure — increment attempts, record the sanitized reason, and either leave the row
   * `pending` for the next backoff window or, once `maxAttempts` is reached, move it to the terminal
   * `dead_letter` state (§53, §56). `claimed_at` is refreshed so it acts as the last-attempt time. */
  async markFailed(db: EventProcessorDatabase, id: string, sanitizedError: string, maxAttempts: number): Promise<void> {
    await db.execute(sql`
      UPDATE event_outbox
      SET status = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'dead_letter' ELSE 'pending' END,
          attempts = attempts + 1,
          last_error = ${sanitizedError},
          claimed_at = now()
      WHERE id = ${id} AND status = 'processing'
    `);
  }

  /** A permanently-undeliverable event (unknown version, malformed envelope) — dead-letter now,
   * retrying cannot help (§157, §158). Not deleted (§147). */
  async markTerminal(db: EventProcessorDatabase, id: string, sanitizedError: string): Promise<void> {
    await db.execute(sql`
      UPDATE event_outbox
      SET status = 'dead_letter', last_error = ${sanitizedError}, claimed_at = now()
      WHERE id = ${id} AND status = 'processing'
    `);
  }

  /**
   * Dead-letter any `processing` row that has already exhausted `maxAttempts` but never reached a
   * `markFailed`/`markDelivered` — i.e. a poison event whose handler keeps crashing the worker
   * mid-dispatch (§57). Called once per poll cycle before claiming. Returns how many were reaped.
   */
  async reapStale(db: EventProcessorDatabase, config: EventProcessorConfig): Promise<number> {
    const rows = await db.execute<{ id: string }>(sql`
      UPDATE event_outbox
      SET status = 'dead_letter',
          last_error = COALESCE(NULLIF(last_error, ''), 'exceeded max attempts (stale claim never completed)')
      WHERE status = 'processing'
        AND attempts >= ${config.maxAttempts}
        AND claimed_at < now() - (${config.staleClaimMs}::double precision * interval '1 millisecond')
      RETURNING id
    `);
    return rows.length;
  }
}
