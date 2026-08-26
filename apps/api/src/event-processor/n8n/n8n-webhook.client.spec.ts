import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventEnvelope } from '../../common/events/domain-event.contracts';
import { EVENT_TYPES } from '../../common/events/event-types';
import { isPermanentDeliveryError } from '../delivery-failure';
import type { N8nDeliveryConfig } from './n8n-delivery.config';
import { N8nWebhookClient } from './n8n-webhook.client';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

interface Received {
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let received: Received[] = [];
let handler: Handler;

const OK_HANDLER: Handler = (_req, res) => {
  res.statusCode = 200;
  res.end('{"ok":true}');
};

function baseUrl(): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}/webhook/saas-events`;
}

function config(overrides: Partial<N8nDeliveryConfig> = {}): N8nDeliveryConfig {
  return {
    enabled: true,
    webhookUrl: baseUrl(),
    authToken: 's3cret-token-abcdefghijklmnop',
    timeoutMs: 500,
    ...overrides,
  };
}

function envelope(): DomainEventEnvelope {
  return {
    eventId: '018f3a2b-0000-7000-8000-000000000001',
    eventType: EVENT_TYPES.ORDER_CONFIRMED,
    eventVersion: 1,
    occurredAt: '2026-08-26T10:00:00.000Z',
    tenantId: '018f3a2b-0000-7000-8000-0000000000aa',
    aggregateType: 'order',
    aggregateId: '018f3a2b-0000-7000-8000-0000000000bb',
    correlationId: '018f3a2b-0000-7000-8000-0000000000cc',
    actor: { type: 'user', id: '018f3a2b-0000-7000-8000-0000000000dd' },
    data: { orderId: '018f3a2b-0000-7000-8000-0000000000bb', orderNumber: 'ORD-000123', total: 42 },
  };
}

async function postAndCatch(cfg: N8nDeliveryConfig): Promise<unknown> {
  try {
    await new N8nWebhookClient(cfg).post(envelope());
  } catch (error) {
    return error;
  }
  throw new Error('expected N8nWebhookClient.post to reject');
}

beforeEach(async () => {
  received = [];
  handler = OK_HANDLER;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ method: req.method, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('N8nWebhookClient.post', () => {
  it('N2: POSTs the exact envelope as JSON and resolves on 200 (§26/§32/§71)', async () => {
    await new N8nWebhookClient(config()).post(envelope());
    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe('POST');
    expect(received[0]?.headers['content-type']).toContain('application/json');
    expect(JSON.parse(received[0]?.body ?? '{}')).toEqual(envelope());
  });

  it('N3: sends Authorization: Bearer and non-secret trace headers, never the secret in the body (§27/§29/§72)', async () => {
    await new N8nWebhookClient(config()).post(envelope());
    const h = received[0]?.headers ?? {};
    expect(h['authorization']).toBe('Bearer s3cret-token-abcdefghijklmnop');
    expect(h['x-event-id']).toBe('018f3a2b-0000-7000-8000-000000000001');
    expect(h['x-event-type']).toBe('sales.order.confirmed');
    expect(h['x-event-version']).toBe('1');
    expect(h['x-tenant-id']).toBe('018f3a2b-0000-7000-8000-0000000000aa');
    expect(h['x-correlation-id']).toBe('018f3a2b-0000-7000-8000-0000000000cc');
    expect(received[0]?.body).not.toContain('s3cret-token');
  });

  it('N4: a timeout is a retryable failure (§30/§31/§73)', async () => {
    handler = () => {
      /* never responds */
    };
    const error = await postAndCatch(config({ timeoutMs: 100 }));
    expect(isPermanentDeliveryError(error)).toBe(false);
    expect((error as Error).message).toMatch(/retryable/);
    expect((error as Error).message).toMatch(/timed out/);
  });

  it('N5: a 500 is retryable (§74)', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('upstream boom');
    };
    const error = await postAndCatch(config());
    expect(isPermanentDeliveryError(error)).toBe(false);
    expect((error as Error).message).toMatch(/HTTP 500/);
  });

  it('N6: a 429 is retryable (§75)', async () => {
    handler = (_req, res) => {
      res.statusCode = 429;
      res.end('slow down');
    };
    expect(isPermanentDeliveryError(await postAndCatch(config()))).toBe(false);
  });

  it('N7: a 401 is a permanent delivery error (§76)', async () => {
    handler = (_req, res) => {
      res.statusCode = 401;
      res.end('unauthorized');
    };
    expect(isPermanentDeliveryError(await postAndCatch(config()))).toBe(true);
  });

  it('N8: a 400 and a 422 are permanent delivery errors (§77)', async () => {
    for (const status of [400, 422]) {
      handler = (_req, res) => {
        res.statusCode = status;
        res.end('bad request');
      };
      expect(isPermanentDeliveryError(await postAndCatch(config()))).toBe(true);
    }
  });

  it('N9: a secret-looking error body is sanitized before it can reach last_error/logs (§36/§79)', async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end('failed: Authorization: Bearer super-secret-value api_key=abc123def456');
    };
    const message = (await postAndCatch(config()) as Error).message;
    expect(message).not.toContain('super-secret-value');
    expect(message).not.toContain('abc123def456');
    expect(message).toMatch(/redacted/);
  });

  it('N10: a redirect to another host is NOT followed and is permanent (§24/§80)', async () => {
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'https://evil.example.com/steal');
      res.end();
    };
    expect(isPermanentDeliveryError(await postAndCatch(config()))).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('N14: the same eventId is sent on every attempt (§28/§84)', async () => {
    let calls = 0;
    handler = (_req, res) => {
      calls += 1;
      res.statusCode = calls === 1 ? 503 : 200;
      res.end();
    };
    const client = new N8nWebhookClient(config());
    await expect(client.post(envelope())).rejects.toThrow();
    await client.post(envelope());
    expect(received.map((r) => r.headers['x-event-id'])).toEqual([
      '018f3a2b-0000-7000-8000-000000000001',
      '018f3a2b-0000-7000-8000-000000000001',
    ]);
  });

  it('omits x-tenant-id / x-correlation-id when the envelope has none', async () => {
    const platformEvent: DomainEventEnvelope = { ...envelope(), tenantId: null, correlationId: null };
    await new N8nWebhookClient(config()).post(platformEvent);
    const h = received[0]?.headers ?? {};
    expect(h['x-tenant-id']).toBeUndefined();
    expect(h['x-correlation-id']).toBeUndefined();
  });
});
