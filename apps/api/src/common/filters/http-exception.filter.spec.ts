import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

function hostFor(correlationId = 'corr-1') {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ send });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ correlationId }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, send };
}

describe('HttpExceptionFilter', () => {
  it('maps a known HttpException to the standard envelope, echoing the correlation id', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, send } = hostFor('abc-123');

    filter.catch(new UnauthorizedException('Invalid or expired session.'), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session.',
      correlationId: 'abc-123',
    });
  });

  it('flattens a class-validator array message into one string', () => {
    const filter = new HttpExceptionFilter();
    const { host, send } = hostFor();

    filter.catch(new BadRequestException({ message: ['email must be an email', 'password too short'] }), host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'email must be an email password too short' }),
    );
  });

  it('never leaks a raw error message or stack trace for an unknown/unexpected error', () => {
    const filter = new HttpExceptionFilter();
    const { host, send } = hostFor();

    filter.catch(new Error('super secret internal detail: DATABASE_URL=postgres://...'), host);

    const body = send.mock.calls[0]?.[0];
    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      correlationId: 'corr-1',
    });
    expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
  });

  it('maps ForbiddenException to 403/FORBIDDEN', () => {
    const filter = new HttpExceptionFilter();
    const { host, send } = hostFor();
    filter.catch(new ForbiddenException('Missing required permission.'), host);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
  });
});
