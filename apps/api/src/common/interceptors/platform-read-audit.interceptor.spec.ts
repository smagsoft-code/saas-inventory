import { NotFoundException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_READ_ACTION, PlatformReadAuditInterceptor } from './platform-read-audit.interceptor';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

function build(opts: { record?: ReturnType<typeof vi.fn>; request?: Record<string, unknown>; resource?: string | undefined; tenantExists?: boolean; statusCode?: number } = {}) {
  const record = opts.record ?? vi.fn().mockResolvedValue(undefined);
  const request = {
    method: 'GET',
    routeOptions: { url: '/api/v1/platform/tenants/:tenantId' },
    params: { tenantId: TENANT_ID },
    query: { probe: 'a value' },
    correlationId: 'corr-1',
    ip: '10.0.0.1',
    platformPrincipal: { adminId: ADMIN_ID },
    ...opts.request,
  };
  const context = {
    getType: () => 'http',
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: opts.statusCode ?? 200 }) }),
  } as unknown as ExecutionContext;
  const reflector = { get: () => ('resource' in opts ? opts.resource : 'tenant') };
  const tenants = { findById: vi.fn().mockResolvedValue(opts.tenantExists === false ? undefined : { id: TENANT_ID }) };
  const interceptor = new PlatformReadAuditInterceptor({ record } as never, reflector as never, tenants as never);
  return { interceptor, record, context, tenants };
}
const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });
const failing = (error: unknown): CallHandler => ({ handle: () => throwError(() => error) });

describe('PlatformReadAuditInterceptor (PLATFORM-READS-NOT-AUDITED, option B)', () => {
  it('writes one platform.read row: platform admin, the existing path tenant, template route, resource, outcome, query KEY names — no values', async () => {
    const { interceptor, record, context } = build();
    expect(await lastValueFrom(interceptor.intercept(context, handler({ id: TENANT_ID })))).toEqual({ id: TENANT_ID });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorId: ADMIN_ID,
      actionCode: PLATFORM_READ_ACTION,
      entityType: 'tenant',
      entityId: TENANT_ID,
      afterState: { method: 'GET', route: '/api/v1/platform/tenants/:tenantId', resource: 'tenant', outcome: 'success', statusCode: 200, queryKeys: ['probe'] },
      correlationId: 'corr-1',
      ipAddress: '10.0.0.1',
    });
    expect(JSON.stringify(record.mock.calls[0])).not.toContain('a value');
  });

  it('is opt-in and inert: no resource metadata, no platform principal, a non-GET verb, or a path value that is not a uuid', async () => {
    for (const opts of [{ resource: undefined }, { request: { platformPrincipal: undefined } }, { request: { method: 'POST' } }, { request: { params: { tenantId: 'not-a-uuid' } } }]) {
      const { interceptor, record, context } = build(opts);
      await lastValueFrom(interceptor.intercept(context, handler('ok')));
      expect(record).not.toHaveBeenCalled();
    }
  });

  it('attributes the tenant only if it EXISTS: an unknown uuid is recorded with no tenant (the foreign key is never asked to hold it)', async () => {
    const { interceptor, record, context, tenants } = build({ tenantExists: false });
    await lastValueFrom(interceptor.intercept(context, handler(null)));
    expect(tenants.findById).toHaveBeenCalledWith(TENANT_ID);
    expect(record.mock.calls[0]![0]).toMatchObject({ tenantId: undefined, entityId: TENANT_ID });
  });

  it('records a failure outcome and re-throws the ORIGINAL error', async () => {
    const { interceptor, record, context } = build();
    const error = new NotFoundException();
    await expect(lastValueFrom(interceptor.intercept(context, failing(error)))).rejects.toBe(error);
    expect(record.mock.calls[0]![0].afterState).toMatchObject({ outcome: 'not_found', statusCode: 404 });
  });

  it('FAIL-CLOSED on success: an audit failure withholds the data, after ONE attempt', async () => {
    const record = vi.fn().mockRejectedValue(new Error('audit db down'));
    const { interceptor, context } = build({ record });
    await expect(lastValueFrom(interceptor.intercept(context, handler({ secret: 'tenant data' })))).rejects.toThrow('audit db down');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('on an error outcome an audit failure never masks the real error', async () => {
    const { interceptor, context } = build({ record: vi.fn().mockRejectedValue(new Error('audit db down')) });
    const original = new NotFoundException('nope');
    await expect(lastValueFrom(interceptor.intercept(context, failing(original)))).rejects.toBe(original);
  });
});
