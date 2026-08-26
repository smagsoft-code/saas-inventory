import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateId } from '@saas-inventory/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventEnvelope } from '../../src/common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../src/common/events/event-types';
import { EventClaimRepository } from '../../src/event-processor/event-claim.repository';
import { EventDispatcher } from '../../src/event-processor/event-dispatcher.service';
import { EventProcessorService } from '../../src/event-processor/event-processor.service';
import type { N8nDeliveryConfig } from '../../src/event-processor/n8n/n8n-delivery.config';
import { buildN8nEventHandlers } from '../../src/event-processor/n8n/n8n-event-delivery';
import { N8nWebhookClient } from '../../src/event-processor/n8n/n8n-webhook.client';
import { eventProcessorIntegrationTestsEnabled, getAppEventProcessorDatabaseUrl, getMigratorDb } from '../database/helpers';

/**
 * FASE 15 — the Event Processor → n8n delivery adapter, exercised end to end against REAL
 * PostgreSQL (`event_outbox` claim / retry / dead-letter) and a REAL local HTTP receiver standing
 * in for n8n (§142, §143). No mocks for outbox state (§143). The fake receiver never involves
 * Telegram — this validates only the SaaS → n8n webhook contract (§93).
 *
 * `sales.return.resolved` is used for the outbox-lifecycle cases because
 * `event-processor.integration.test.ts` only ever drives `runOnce` for
 * `sales.order.confirmed` / `sales.order.cancelled`, so those rows can never be claimed out from
 * under this file by a sibling suite running in parallel. Payload-contract cases call the handler
 * directly for the same reason.
 */
describe.skipIf(!eventProcessorIntegrationTestsEnabled)('events: n8n delivery adapter (integration)', () => {
  // --- fake n8n receiver ----------------------------------------------------
  type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
  interface Received {
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }
  let server: Server;
  let received: Received[] = [];
  let handler: Handler;
  const OK: Handler = (_req, res) => {
    res.statusCode = 200;
    res.end('{"received":true}');
  };

  function url(): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}/webhook/saas-events`;
  }
  function config(overrides: Partial<N8nDeliveryConfig> = {}): N8nDeliveryConfig {
    return { enabled: true, webhookUrl: url(), authToken: 'integration-secret-abcdefghij', timeoutMs: 400, ...overrides };
  }
  function makeService(cfg: N8nDeliveryConfig): EventProcessorService {
    const dispatcher = new EventDispatcher(buildN8nEventHandlers(cfg, new N8nWebhookClient(cfg)));
    return new EventProcessorService(new EventClaimRepository(), dispatcher);
  }

  // --- outbox helpers -----------------------------------------------------
  let seedSeq = 0;
  async function seedTenant(): Promise<string> {
    const id = generateId();
    const { client } = getMigratorDb();
    try {
      await client`insert into tenants (id, name, slug) values (${id}, ${`n8n ${id}`}, ${`n8n-${id.slice(0, 20)}`})`;
    } finally {
      await client.end();
    }
    return id;
  }

  function envelope(tenantId: string, eventType: string, data: Record<string, unknown>, eventVersion = 1): DomainEventEnvelope {
    return {
      eventId: generateId(),
      eventType: eventType as DomainEventEnvelope['eventType'],
      eventVersion,
      occurredAt: new Date().toISOString(),
      tenantId,
      aggregateType: eventType.startsWith('sales.price_approval') ? 'price_approval' : eventType.startsWith('sales.return') ? 'sales_return' : 'order',
      aggregateId: generateId(),
      correlationId: generateId(),
      actor: { type: 'user', id: generateId() },
      data,
    };
  }

  async function seedEvent(
    env: DomainEventEnvelope,
    opts: { status?: string; attempts?: number } = {},
  ): Promise<string> {
    seedSeq += 1;
    const createdAt = new Date(Date.parse('2000-01-01T00:00:00Z') + seedSeq * 1000).toISOString();
    const { client } = getMigratorDb();
    try {
      await client`
        insert into event_outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, attempts, created_at)
        values (${env.eventId}, ${env.tenantId}, ${env.aggregateType}, ${env.aggregateId}, ${env.eventType},
                ${JSON.stringify(env)}::jsonb, ${opts.status ?? 'pending'}, ${opts.attempts ?? 0}, ${createdAt})`;
    } finally {
      await client.end();
    }
    return env.eventId;
  }

  async function row(id: string): Promise<{ status: string; attempts: number; last_error: string | null; processed_at: Date | null; payload: DomainEventEnvelope }> {
    const { client } = getMigratorDb();
    try {
      const rows = await client<{ status: string; attempts: number; last_error: string | null; processed_at: Date | null; payload: DomainEventEnvelope }[]>`
        select status, attempts, last_error, processed_at, payload from event_outbox where id = ${id}`;
      return rows[0]!;
    } finally {
      await client.end();
    }
  }

  async function runUntil(service: EventProcessorService, id: string, want: string[], maxCycles = 40): Promise<string> {
    for (let i = 0; i < maxCycles; i += 1) {
      await service.runOnce(`w-${String(seedSeq)}`);
      const r = await row(id);
      if (want.includes(r.status)) return r.status;
      await new Promise((res) => setTimeout(res, 10));
    }
    return (await row(id)).status;
  }

  function mineReceived(eventId: string): Received[] {
    return received.filter((r) => r.headers['x-event-id'] === eventId);
  }

  beforeAll(() => {
    process.env['APP_EVENT_PROCESSOR_DATABASE_URL'] = getAppEventProcessorDatabaseUrl();
    process.env['EVENT_PROCESSOR_CLAIM_BATCH_SIZE'] = '50';
    process.env['EVENT_PROCESSOR_MAX_ATTEMPTS'] = '3';
    process.env['EVENT_PROCESSOR_RETRY_BASE_MS'] = '1';
    process.env['EVENT_PROCESSOR_RETRY_MAX_MS'] = '10';
    process.env['EVENT_PROCESSOR_STALE_CLAIM_MS'] = '60000';
  });

  afterAll(async () => {
    const mod = await import('../../src/database/event-processor-client');
    await mod.closeEventProcessorPostgresClient();
  });

  beforeEach(async () => {
    received = [];
    handler = OK;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        handler(req, res, Buffer.concat(chunks).toString('utf8'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // --- N-INT-1: success --------------------------------------------------
  it('delivers a pending event and marks it delivered; the receiver gets the exact envelope (§71/§81/§184)', async () => {
    const t = await seedTenant();
    const env = envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId(), orderId: generateId(), lines: [] });
    const id = await seedEvent(env);

    expect(await runUntil(makeService(config()), id, ['delivered'])).toBe('delivered');
    const got = mineReceived(id);
    expect(got).toHaveLength(1);
    const body = JSON.parse(got[0]!.body) as DomainEventEnvelope;
    expect(body.eventId).toBe(id); // §81 body.eventId == row.id
    expect(body).toEqual(env); // whole envelope intact (§81)
    expect(got[0]!.headers['authorization']).toBe('Bearer integration-secret-abcdefghij');
    expect((await row(id)).processed_at).not.toBeNull();
  });

  // --- N-INT-2: 500 -> retryable --------------------------------------
  it('a 500 leaves the event retryable (pending), attempts incremented, not delivered (§74)', async () => {
    const t = await seedTenant();
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('upstream error');
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    const svc = makeService(config());
    await svc.runOnce('w-500');
    const r = await row(id);
    expect(r.status).toBe('pending');
    expect(r.attempts).toBeGreaterThanOrEqual(1);
    expect(r.processed_at).toBeNull();
  });

  // --- N-INT-3: 429 -> retryable -------------------------------------
  it('a 429 is retryable (§75)', async () => {
    const t = await seedTenant();
    handler = (_req, res) => {
      res.statusCode = 429;
      res.end('rate limited');
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    await makeService(config()).runOnce('w-429');
    expect((await row(id)).status).toBe('pending');
  });

  // --- N-INT-4: 401 -> permanent / dead_letter -----------------------
  it('a 401 dead-letters the event (permanent, not retried, §76/§185)', async () => {
    const t = await seedTenant();
    handler = (_req, res) => {
      res.statusCode = 401;
      res.end('unauthorized');
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    await makeService(config()).runOnce('w-401');
    const r = await row(id);
    expect(r.status).toBe('dead_letter');
    expect(r.attempts).toBe(0); // terminal now, not attempt-based
  });

  // --- N-INT-5: 422 -> dead_letter ----------------------------------
  it('a 422 dead-letters the event (§77)', async () => {
    const t = await seedTenant();
    handler = (_req, res) => {
      res.statusCode = 422;
      res.end('unprocessable');
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    await makeService(config()).runOnce('w-422');
    expect((await row(id)).status).toBe('dead_letter');
  });

  // --- N-INT-6: timeout -> retryable -------------------------------
  it('a timeout is retryable, the event is not delivered (§73)', async () => {
    const t = await seedTenant();
    handler = () => {
      /* never responds */
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    await makeService(config({ timeoutMs: 80 })).runOnce('w-timeout');
    const r = await row(id);
    expect(r.status).toBe('pending');
    expect(r.processed_at).toBeNull();
  });

  // --- N-INT-7: sanitized error body ------------------------------
  it('a secret-looking 500 body is sanitized in last_error (§78/§153)', async () => {
    const t = await seedTenant();
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('boom Authorization: Bearer leaked-secret-value password=hunter2abcdef');
    };
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    await makeService(config()).runOnce('w-redact');
    const r = await row(id);
    expect(r.last_error).not.toBeNull();
    expect(r.last_error).not.toContain('leaked-secret-value');
    expect(r.last_error).not.toContain('hunter2abcdef');
    expect(r.last_error).toMatch(/redacted/);
  });

  // --- N-INT-8: retry keeps the same eventId ---------------------
  it('attempt 1 fails, attempt 2 succeeds -> one delivery, SAME eventId on both HTTP calls (§28/§83)', async () => {
    const t = await seedTenant();
    const env = envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() });
    const id = await seedEvent(env);
    // Decide per-event (foreign rows from sibling suites hit this receiver in parallel) — only
    // THIS event's first attempt fails.
    const attemptsByEvent = new Map<string, number>();
    handler = (_req, res, body) => {
      const received = JSON.parse(body) as DomainEventEnvelope;
      const n = (attemptsByEvent.get(received.eventId) ?? 0) + 1;
      attemptsByEvent.set(received.eventId, n);
      res.statusCode = received.eventId === id && n === 1 ? 503 : 200;
      res.end();
    };
    expect(await runUntil(makeService(config()), id, ['delivered'])).toBe('delivered');
    const mine = mineReceived(id);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mine.map((r) => r.headers['x-event-id']))).toEqual(new Set([id]));
  });

  // --- N-INT-9: disabled -> nothing claimed --------------------
  it('with the adapter disabled, supportedTypes is empty and the event stays pending (§84)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }));
    const svc = new EventProcessorService(new EventClaimRepository(), new EventDispatcher([]));
    expect(await svc.runOnce('w-disabled')).toBe(0);
    const r = await row(id);
    expect(r.status).toBe('pending');
    expect(r.attempts).toBe(0);
    expect(received).toHaveLength(0);
  });

  // --- N-INT-10: enabled -> 8 supported types ------------------
  it('with the adapter enabled, the dispatcher supports the 8 SALES events and the backlog becomes claimable (§85/§86)', async () => {
    const t = await seedTenant();
    const dispatcher = new EventDispatcher(buildN8nEventHandlers(config(), new N8nWebhookClient(config())));
    expect(dispatcher.supportedTypes()).toHaveLength(8);

    // a "legacy" pending event seeded before the handler existed is delivered without change (§86/§87)
    const env = envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() });
    const id = await seedEvent(env, { status: 'pending', attempts: 0 });
    expect(await runUntil(new EventProcessorService(new EventClaimRepository(), dispatcher), id, ['delivered'])).toBe('delivered');
    expect((await row(id)).payload.eventId).toBe(id); // eventId never changed
  });

  // --- N-INT-11: poison permanent event does not block others -----
  it('a permanently-failing event is isolated; a valid event still gets delivered (§91)', async () => {
    const t = await seedTenant();
    const poison = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: 'poison' }));
    const good = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: 'good' }));
    handler = (_req, res, body) => {
      const parsed = JSON.parse(body) as DomainEventEnvelope;
      const isPoison = (parsed.data as { returnId?: string }).returnId === 'poison';
      res.statusCode = isPoison ? 400 : 200;
      res.end();
    };
    const svc = makeService(config());
    await runUntil(svc, good, ['delivered']);
    expect((await row(good)).status).toBe('delivered');
    expect((await row(poison)).status).toBe('dead_letter');
  });

  // --- N-INT-12: dead_letter is not reprocessed ------------------
  it('a dead_letter event is never claimed again (§92)', async () => {
    const t = await seedTenant();
    const id = await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() }), { status: 'dead_letter', attempts: 3 });
    await makeService(config()).runOnce('w-dl');
    expect(mineReceived(id)).toHaveLength(0);
    expect((await row(id)).status).toBe('dead_letter');
  });

  // --- N-INT-13: two processors, no duplicate claim -------------
  it('two concurrent processors never double-claim one event (§88)', async () => {
    const t = await seedTenant();
    const ids = new Set<string>();
    for (let i = 0; i < 8; i += 1) ids.add(await seedEvent(envelope(t, EVENT_TYPES.SALES_RETURN_RESOLVED, { returnId: generateId() })));
    const a = makeService(config());
    const b = makeService(config());
    await Promise.all([a.runOnce('wA'), b.runOnce('wB')]);
    for (const id of ids) {
      // each delivered exactly once (headers to the fake receiver dedupe cleanly on eventId)
      expect(mineReceived(id).length).toBeLessThanOrEqual(1);
    }
  });

  // --- N-INT-14: price approval payload — no floor / cost leak ---
  it('sales.price_approval.requested delivered to n8n carries NO minPrice / cost fields (§81/§152)', async () => {
    const t = await seedTenant();
    const env = envelope(t, EVENT_TYPES.PRICE_APPROVAL_REQUESTED, {
      approvalId: generateId(),
      orderId: generateId(),
      orderNumber: 'ORD-000777',
      orderItemId: generateId(),
      productVariantId: generateId(),
      sku: 'SKU-XYZ',
      productName: 'Test Fridge',
      quantity: 1,
      requestedPrice: 70,
      maxPriceAtRequest: 120,
      discountAmount: 50,
      reason: 'loyal customer',
      requestedByUserId: generateId(),
    });
    const handlers = buildN8nEventHandlers(config(), new N8nWebhookClient(config()));
    const h = handlers.find((x) => x.eventType === EVENT_TYPES.PRICE_APPROVAL_REQUESTED)!;
    await h.deliver(env);

    const body = mineReceived(env.eventId)[0]!.body;
    expect(body).not.toMatch(/minPrice|minPriceAtRequest|unitCost|"cost"|basePrice/i);
    const parsed = JSON.parse(body) as DomainEventEnvelope;
    expect((parsed.data as Record<string, unknown>)['maxPriceAtRequest']).toBe(120);
    expect((parsed.data as Record<string, unknown>)['requestedPrice']).toBe(70);
  });

  // --- N-INT-15: order confirmed notification contract ----------
  it('sales.order.confirmed delivered to n8n has every field a Telegram notification needs, no internal leak (§40/§41/§93)', async () => {
    const t = await seedTenant();
    const env = envelope(t, EVENT_TYPES.ORDER_CONFIRMED, {
      orderId: generateId(),
      orderNumber: 'ORD-000123',
      documentType: 'invoice',
      invoiceStatus: 'pending',
      currency: 'USD',
      subtotal: 285,
      discountTotal: 0,
      taxTotal: 0,
      total: 285,
      locationId: generateId(),
      placedByUserId: generateId(),
      hasExceptionalDiscount: false,
      customer: { name: 'Cliente Demo', taxId: '0999999999', email: 'demo@example.invalid', phone: '0000000000', address: { line1: 'Calle Falsa 123' } },
      lines: [{ productVariantId: generateId(), sku: 'SKU-1', productName: 'Fridge', quantity: 3, unitPrice: 95, discountAmount: 0, lineTotal: 285 }],
    });
    const handlers = buildN8nEventHandlers(config(), new N8nWebhookClient(config()));
    await handlers.find((x) => x.eventType === EVENT_TYPES.ORDER_CONFIRMED)!.deliver(env);

    const data = (JSON.parse(mineReceived(env.eventId)[0]!.body) as DomainEventEnvelope).data as Record<string, unknown>;
    expect(data['orderNumber']).toBe('ORD-000123');
    expect(data['documentType']).toBe('invoice');
    expect(data['total']).toBe(285);
    expect((data['customer'] as Record<string, unknown>)['name']).toBe('Cliente Demo');
    expect((data['customer'] as Record<string, unknown>)['email']).toBe('demo@example.invalid');
    expect(Array.isArray(data['lines'])).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/minPrice|unitCost|"cost"|basePrice|maxPrice/i);
  });
});
