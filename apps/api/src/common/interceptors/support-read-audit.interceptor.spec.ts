import { ForbiddenException, NotFoundException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { outcomeForStatus, SUPPORT_READ_ACTION, SupportReadAuditInterceptor } from './support-read-audit.interceptor';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';

function build(opts: { record?: ReturnType<typeof vi.fn>; request?: Record<string, unknown>; statusCode?: number } = {}) {
  const record = opts.record ?? vi.fn().mockResolvedValue(undefined);
  const request = {
    method: 'GET',
    routeOptions: { url: '/api/v1/orders/:id' },
    params: { id: RESOURCE_ID },
    query: { q: 'a customer name', page: '2' },
    correlationId: 'corr-1',
    ip: '10.0.0.1',
    platformPrincipal: { adminId: ADMIN_ID },
    supportSession: { supportSessionId: SESSION_ID, tenantId: TENANT_ID, mode: 'read' },
    ...opts.request,
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: opts.statusCode ?? 200 }) }),
  } as unknown as ExecutionContext;
  const interceptor = new SupportReadAuditInterceptor({ record } as never);
  return { interceptor, record, context };
}
const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });
const failing = (error: unknown): CallHandler => ({ handle: () => throwError(() => error) });

describe('SupportReadAuditInterceptor (SUP-READ-NOT-AUDITED)', () => {
  it('writes one platform-admin row for a read under a support session: tenant, session, route template, outcome, query KEY names, resource id — no values', async () => {
    const { interceptor, record, context } = build();
    const result = await lastValueFrom(interceptor.intercept(context, handler({ data: 1 })));
    expect(result).toEqual({ data: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorId: ADMIN_ID,
      actionCode: SUPPORT_READ_ACTION,
      entityType: 'support_session',
      entityId: SESSION_ID,
      afterState: { method: 'GET', route: '/api/v1/orders/:id', outcome: 'success', statusCode: 200, mode: 'read', queryKeys: ['q', 'page'], resourceId: RESOURCE_ID },
      correlationId: 'corr-1',
      ipAddress: '10.0.0.1',
    });
    expect(JSON.stringify(record.mock.calls[0])).not.toContain('a customer name');
  });

  it('is inert without a support session, for non-GET verbs and for non-http contexts', async () => {
    for (const request of [{ supportSession: undefined }, { method: 'POST' }, { platformPrincipal: undefined }]) {
      const { interceptor, record, context } = build({ request });
      await lastValueFrom(interceptor.intercept(context, handler('ok')));
      expect(record).not.toHaveBeenCalled();
    }
    const { interceptor, record } = build();
    const rpc = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(rpc, handler('ok')));
    expect(record).not.toHaveBeenCalled();
  });

  it('does not treat the session :tenantId as the resource, and omits resourceId when the route has none', async () => {
    const a = build({ request: { params: { tenantId: TENANT_ID }, routeOptions: { url: '/api/v1/platform/tenants/:tenantId/support/users' } } });
    await lastValueFrom(a.interceptor.intercept(a.context, handler([])));
    expect(a.record.mock.calls[0]![0].afterState).not.toHaveProperty('resourceId');
    const b = build({ request: { params: {}, query: {} } });
    await lastValueFrom(b.interceptor.intercept(b.context, handler([])));
    expect(b.record.mock.calls[0]![0].afterState).toMatchObject({ queryKeys: [] });
  });

  it('records the failure outcome and re-throws the ORIGINAL error (404 → not_found, 403 → denied)', async () => {
    for (const [error, outcome, status] of [[new NotFoundException(), 'not_found', 404], [new ForbiddenException(), 'denied', 403], [new Error('boom'), 'error', 500]] as const) {
      const { interceptor, record, context } = build();
      await expect(lastValueFrom(interceptor.intercept(context, failing(error)))).rejects.toBe(error);
      expect(record.mock.calls[0]![0].afterState).toMatchObject({ outcome, statusCode: status });
    }
  });

  it('FAIL-CLOSED on success: if the audit row cannot be written the data is NOT returned', async () => {
    const { interceptor, context } = build({ record: vi.fn().mockRejectedValue(new Error('audit db down')) });
    await expect(lastValueFrom(interceptor.intercept(context, handler({ secret: 'customer data' })))).rejects.toThrow('audit db down');
  });

  it('a failed success-audit is attempted ONCE: it is not retried as an "error" row', async () => {
    const record = vi.fn().mockRejectedValue(new Error('audit db down'));
    const { interceptor, context } = build({ record });
    await expect(lastValueFrom(interceptor.intercept(context, handler('data')))).rejects.toThrow('audit db down');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0].afterState).toMatchObject({ outcome: 'success' });
  });

  it('on an error outcome an audit failure never masks the caller\'s real error', async () => {
    const { interceptor, context } = build({ record: vi.fn().mockRejectedValue(new Error('audit db down')) });
    const original = new NotFoundException('nope');
    await expect(lastValueFrom(interceptor.intercept(context, failing(original)))).rejects.toBe(original);
  });

  it('maps status codes to outcomes', () => {
    expect([200, 204, 404, 401, 403, 400, 409, 422, 500, 503].map(outcomeForStatus)).toEqual(['success', 'success', 'not_found', 'denied', 'denied', 'rejected', 'rejected', 'rejected', 'error', 'error']);
  });
});
