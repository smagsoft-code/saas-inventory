import { generateId } from '@saas-inventory/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from '../../src/common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../src/common/events/event-types';
import { EventClaimRepository } from '../../src/event-processor/event-claim.repository';
import { EventDispatcher } from '../../src/event-processor/event-dispatcher.service';
import { EventProcessorService } from '../../src/event-processor/event-processor.service';
import type { EventProcessorConfig } from '../../src/event-processor/event-processor.config';
import type { EventHandler } from '../../src/event-processor/event-delivery.port';
import {
  eventProcessorIntegrationTestsEnabled,
  getAppEventProcessorDatabaseUrl,
  getMigratorDb,
} from '../database/helpers';

/**
 * FASE 14 — the Event Processor's claim / retry / stale-recovery / dead-letter mechanics, and the
 * least-privilege of the `app_event_processor` role, exercised against real PostgreSQL (§46-§58,
 * §110-§119, §164, §125). Events are seeded directly into `event_outbox` (the transactional write
 * path is covered by outbox-transactional / sales-events); this file drives
 * `EventClaimRepository` / `EventProcessorService` over the real dedicated connection.
 */
describe.skipIf(!eventProcessorIntegrationTestsEnabled)('events: Event Processor (integration)', () => {
  const CONFIG: EventProcessorConfig = {
    pollIntervalMs: 10,
    claimBatchSize: 50,
    staleClaimMs: 60_000,
    maxAttempts: 5,
    retryBaseMs: 1,
    retryMaxMs: 10,
    retryFactor: 2,
  };
  const SUPPORTED = [EVENT_TYPES.ORDER_CONFIRMED, EVENT_TYPES.ORDER_CANCELLED];

  const claimRepo = new EventClaimRepository();
  let getEventProcessorDb: () => ReturnType<typeof import('../../src/database/event-processor-client')['getEventProcessorDb']>;
  let closeEpClient: () => Promise<void>;

  beforeAll(async () => {
    process.env['APP_EVENT_PROCESSOR_DATABASE_URL'] = getAppEventProcessorDatabaseUrl();
    const mod = await import('../../src/database/event-processor-client');
    getEventProcessorDb = mod.getEventProcessorDb;
    closeEpClient = mod.closeEventProcessorPostgresClient;
  });

  afterAll(async () => {
    if (closeEpClient) await closeEpClient();
  });

  beforeEach(() => vi.restoreAllMocks());

  // ---- fixtures ------------------------------------------------------------
  async function seedTenant(): Promise<string> {
    const id = generateId();
    const { client } = getMigratorDb();
    try {
      await client`insert into tenants (id, name, slug) values (${id}, ${`EP ${id}`}, ${`ep-${id.slice(0, 20)}`})`;
    } finally {
      await client.end();
    }
    return id;
  }

  function envelope(tenantId: string, eventType: string, eventVersion = 1): DomainEventEnvelope {
    const eventId = generateId();
    return {
      eventId,
      eventType: eventType as DomainEventEnvelope['eventType'],
      eventVersion,
      occurredAt: new Date().toISOString(),
      tenantId,
      aggregateType: 'order',
      aggregateId: generateId(),
      correlationId: null,
      actor: { type: 'user', id: null },
      data: { orderId: generateId() },
    };
  }

  // The integration suite runs `fileParallelism: true` and this claim query is intentionally
  // CROSS-TENANT — other event test files leave `pending` `event_outbox` rows around. Seeding this
  // file's events with a fixed, far-past `created_at` (monotonic per call) guarantees they always
  // sort FIRST under the claim query's `ORDER BY created_at`, so a batch of adequate size always
  // includes them regardless of how many foreign rows exist. Assertions still filter to this
  // file's own event ids.
  let seedSeq = 0;
  async function seedEvent(
    tenantId: string,
    opts: { eventType?: string; eventVersion?: number; status?: string; attempts?: number } = {},
  ): Promise<string> {
    const env = envelope(tenantId, opts.eventType ?? EVENT_TYPES.ORDER_CONFIRMED, opts.eventVersion);
    seedSeq += 1;
    const createdAt = new Date(Date.parse('2000-01-01T00:00:00Z') + seedSeq * 1000).toISOString();
    const { client } = getMigratorDb();
    try {
      await client`
        insert into event_outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, attempts, created_at)
        values (${env.eventId}, ${tenantId}, ${env.aggregateType}, ${env.aggregateId}, ${env.eventType},
                ${JSON.stringify(env)}::jsonb, ${opts.status ?? 'pending'}, ${opts.attempts ?? 0}, ${createdAt})`;
    } finally {
      await client.end();
    }
    return env.eventId;
  }

  async function row(id: string): Promise<{ status: string; attempts: number; last_error: string | null; processed_at: Date | null; claimed_by: string | null; payload: DomainEventEnvelope }> {
    const { client } = getMigratorDb();
    try {
      const rows = await client<{ status: string; attempts: number; last_error: string | null; processed_at: Date | null; claimed_by: string | null; payload: DomainEventEnvelope }[]>`
        select status, attempts, last_error, processed_at, claimed_by, payload from event_outbox where id = ${id}`;
      return rows[0]!;
    } finally {
      await client.end();
    }
  }

  function handler(eventType: string, deliver: EventHandler['deliver'], eventVersion = 1): EventHandler {
    return { eventType, eventVersion, deliver };
  }

  // ---- E1 -----------------------------------------------------------------
  it('E1: claims up to the batch size, stamps claim metadata, sets status = processing', async () => {
    const t = await seedTenant();
    const ids = [await seedEvent(t), await seedEvent(t), await seedEvent(t)];
    const db = getEventProcessorDb();

    const first = await claimRepo.claimBatch(db, 'w1', SUPPORTED, { ...CONFIG, claimBatchSize: 2 });
    expect(first.filter((e) => ids.includes(e.id))).toHaveLength(2);
    for (const e of first) {
      const r = await row(e.id);
      expect(r.status).toBe('processing');
      expect(r.claimed_by).toBe('w1');
    }
    const second = await claimRepo.claimBatch(db, 'w1', SUPPORTED, { ...CONFIG, claimBatchSize: 2 });
    expect(second.filter((e) => ids.includes(e.id))).toHaveLength(1);
  });

  // ---- E2 -----------------------------------------------------------------
  it('E2: two concurrent processors never claim the same event (FOR UPDATE SKIP LOCKED, §47/§111)', async () => {
    const t = await seedTenant();
    const ids = new Set<string>();
    for (let i = 0; i < 12; i += 1) ids.add(await seedEvent(t));
    const db = getEventProcessorDb();

    const [a, b] = await Promise.all([
      claimRepo.claimBatch(db, 'wA', SUPPORTED, CONFIG),
      claimRepo.claimBatch(db, 'wB', SUPPORTED, CONFIG),
    ]);
    const claimed = [...a, ...b].filter((e) => ids.has(e.id)).map((e) => e.id);
    expect(new Set(claimed).size).toBe(claimed.length); // no duplicate
    expect(claimed.length).toBeLessThanOrEqual(ids.size);
  });

  // ---- E3 -----------------------------------------------------------------
  it('E3: one cross-tenant claim spans tenants A/B/C with no payload/state mixing (§112)', async () => {
    const [tA, tB, tC] = [await seedTenant(), await seedTenant(), await seedTenant()];
    const idA = await seedEvent(tA);
    const idB = await seedEvent(tB, { eventType: EVENT_TYPES.ORDER_CANCELLED });
    const idC = await seedEvent(tC);
    const db = getEventProcessorDb();

    const claimed = await claimRepo.claimBatch(db, 'w-multi', SUPPORTED, CONFIG);
    const byId = new Map(claimed.map((e) => [e.id, e]));
    expect(byId.get(idA)!.tenantId).toBe(tA);
    expect(byId.get(idB)!.tenantId).toBe(tB);
    expect(byId.get(idB)!.eventType).toBe(EVENT_TYPES.ORDER_CANCELLED);
    expect(byId.get(idC)!.tenantId).toBe(tC);
    expect(byId.get(idA)!.payload.eventId).toBe(idA);
  });

  // ---- E4 -----------------------------------------------------------------
  it('E4: a stale claim is reclaimable and the reclaim increments attempts (§50/§51/§113)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t);
    const db = getEventProcessorDb();

    await claimRepo.claimBatch(db, 'w-orig', SUPPORTED, CONFIG);
    // not stale yet
    expect((await claimRepo.claimBatch(db, 'w-reclaim', SUPPORTED, CONFIG)).some((e) => e.id === id)).toBe(false);
    // force staleness
    const reclaimed = await claimRepo.claimBatch(db, 'w-reclaim', SUPPORTED, { ...CONFIG, staleClaimMs: 0 });
    const got = reclaimed.find((e) => e.id === id);
    expect(got).toBeDefined();
    expect(got!.attempts).toBe(1);
    expect((await row(id)).claimed_by).toBe('w-reclaim');
  });

  // ---- E5 / E6 ----------------------------------------------------------
  it('E5: markFailed increments attempts, stores a sanitized error, leaves it retryable (§53/§114)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t);
    const db = getEventProcessorDb();
    await claimRepo.claimBatch(db, 'w1', SUPPORTED, CONFIG);

    await claimRepo.markFailed(db, id, 'delivery failed: token=[redacted]', CONFIG.maxAttempts);
    const r = await row(id);
    expect(r.status).toBe('pending');
    expect(r.attempts).toBe(1);
    expect(r.last_error).toContain('delivery failed');
    expect(r.processed_at).toBeNull();
  });

  it('E6: attempt 1 fails, attempt 2 succeeds -> one delivered event, attempts preserved (§115)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t);
    const db = getEventProcessorDb();

    await claimRepo.claimBatch(db, 'w1', SUPPORTED, CONFIG);
    await claimRepo.markFailed(db, id, 'transient', CONFIG.maxAttempts);
    // backoff window is min(retryMaxMs=10, retryBaseMs=1 * 2^1) = 2ms — wait it out, then reclaim.
    await new Promise((r) => setTimeout(r, 25));
    const again = await claimRepo.claimBatch(db, 'w1', SUPPORTED, CONFIG);
    expect(again.some((e) => e.id === id)).toBe(true);
    await claimRepo.markDelivered(db, id);

    const r = await row(id);
    expect(r.status).toBe('delivered');
    expect(r.attempts).toBe(1);
    expect(r.processed_at).not.toBeNull();
  });

  // ---- E7 -----------------------------------------------------------------
  it('E7: reaching maxAttempts moves the event to the terminal dead_letter state (§56/§116)', async () => {
    const t = await seedTenant();
    // Seed already one attempt short of the ceiling — the next failure is the terminal one.
    const id = await seedEvent(t, { attempts: CONFIG.maxAttempts - 1 });
    const db = getEventProcessorDb();

    const claimed = await claimRepo.claimBatch(db, 'w1', SUPPORTED, CONFIG);
    expect(claimed.some((e) => e.id === id)).toBe(true);
    await claimRepo.markFailed(db, id, 'always fails', CONFIG.maxAttempts);

    const r = await row(id);
    expect(r.status).toBe('dead_letter');
    expect(r.attempts).toBe(CONFIG.maxAttempts);
    // never claimed again, even with staleness forced
    expect((await claimRepo.claimBatch(db, 'w1', SUPPORTED, { ...CONFIG, staleClaimMs: 0 })).some((e) => e.id === id)).toBe(false);
  });

  // ---- E8 -----------------------------------------------------------------
  it('E8: a poison event is isolated — valid events in the same batch still get delivered (§57/§117)', async () => {
    const t = await seedTenant();
    const good1 = await seedEvent(t, { eventType: EVENT_TYPES.ORDER_CONFIRMED });
    const good2 = await seedEvent(t, { eventType: EVENT_TYPES.ORDER_CANCELLED });
    const poison = await seedEvent(t, { eventType: EVENT_TYPES.ORDER_CONFIRMED });

    const delivered = new Set<string>();
    const dispatcher = new EventDispatcher([
      handler(EVENT_TYPES.ORDER_CONFIRMED, async (env) => {
        if (env.eventId === poison) throw new Error('poison');
        delivered.add(env.eventId);
      }),
      handler(EVENT_TYPES.ORDER_CANCELLED, async (env) => {
        delivered.add(env.eventId);
      }),
    ]);
    const service = new EventProcessorService(claimRepo, dispatcher);
    process.env['EVENT_PROCESSOR_MAX_ATTEMPTS'] = '5';
    process.env['EVENT_PROCESSOR_RETRY_BASE_MS'] = '1';
    process.env['EVENT_PROCESSOR_CLAIM_BATCH_SIZE'] = '50';

    await service.runOnce('w-poison');

    expect(delivered.has(good1)).toBe(true);
    expect(delivered.has(good2)).toBe(true);
    expect((await row(good1)).status).toBe('delivered');
    expect((await row(good2)).status).toBe('delivered');
    const p = await row(poison);
    expect(p.status).toBe('pending');
    expect(p.attempts).toBe(1);
  });

  // ---- E9 -----------------------------------------------------------------
  it('E9: crash after delivery, before ack -> redelivery with the SAME eventId (at-least-once, §66/§118)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t);
    const db = getEventProcessorDb();

    const claimed1 = await claimRepo.claimBatch(db, 'w-crash', SUPPORTED, CONFIG);
    const first = claimed1.find((e) => e.id === id)!;
    // "crash" — no markDelivered / markFailed at all. Row stays 'processing'.
    const claimed2 = await claimRepo.claimBatch(db, 'w-recover', SUPPORTED, { ...CONFIG, staleClaimMs: 0 });
    const second = claimed2.find((e) => e.id === id)!;
    expect(second).toBeDefined();
    expect(second.payload.eventId).toBe(first.payload.eventId);
    expect(second.id).toBe(id);
    await claimRepo.markDelivered(db, id);
    expect((await row(id)).status).toBe('delivered');
  });

  // ---- E10 (mandatory) --------------------------------------------------
  it('E10: with NO handler registered, an event is NEVER marked delivered (§61/§119)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t);
    const service = new EventProcessorService(claimRepo, new EventDispatcher([]));

    const claimed = await service.runOnce('w-empty');
    expect(claimed).toBe(0);

    const r = await row(id);
    expect(r.status).toBe('pending');
    expect(r.attempts).toBe(0);
    expect(r.processed_at).toBeNull();
  });

  // ---- unknown version -> terminal ------------------------------------
  it('an unknown event version is dead-lettered, not mis-processed (§157)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(t, { eventVersion: 99 });
    const service = new EventProcessorService(claimRepo, new EventDispatcher([handler(EVENT_TYPES.ORDER_CONFIRMED, vi.fn())]));
    process.env['EVENT_PROCESSOR_CLAIM_BATCH_SIZE'] = '50';
    await service.runOnce('w-ver');
    expect((await row(id)).status).toBe('dead_letter');
  });

  // ---- role least-privilege (§44/§164) --------------------------------
  it('app_event_processor can claim event_outbox but cannot read domain tables', async () => {
    const sql = postgres(getAppEventProcessorDatabaseUrl(), { max: 1 });
    try {
      await expect(sql`select count(*) from event_outbox`).resolves.toBeDefined();
      for (const table of ['orders', 'customers', 'order_items', 'inventory_balances']) {
        await expect(sql.unsafe(`select 1 from ${table} limit 1`)).rejects.toThrow();
      }
      await expect(sql`insert into event_outbox (id, aggregate_type, aggregate_id, event_type, payload) values (gen_random_uuid(), 'x', gen_random_uuid(), 'x', '{}'::jsonb)`).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  // ---- tenant payload isolation (§94) ---------------------------------
  it('as app_tenant, one tenant cannot read another tenant\'s outbox payload (RLS)', async () => {
    const tA = await seedTenant();
    const tB = await seedTenant();
    await seedEvent(tA);
    await seedEvent(tB);

    const appTenant = postgres(process.env['TEST_APP_TENANT_DATABASE_URL']!, { max: 1 });
    try {
      const seenByA = await appTenant.begin(async (tx) => {
        await tx.unsafe(`select set_config('app.tenant_id', $1, true)`, [tA]);
        return tx<{ tenant_id: string }[]>`select tenant_id from event_outbox`;
      });
      expect(seenByA.every((r) => r.tenant_id === tA)).toBe(true);
      expect(seenByA.some((r) => r.tenant_id === tB)).toBe(false);
    } finally {
      await appTenant.end();
    }
  });
});
