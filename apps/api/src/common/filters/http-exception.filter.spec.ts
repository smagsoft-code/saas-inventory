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

  it('ADR-0034: a ForbiddenException thrown with an object body ({code, message}) surfaces that specific code instead of the generic FORBIDDEN', () => {
    const filter = new HttpExceptionFilter();
    const { host, send } = hostFor();
    filter.catch(new ForbiddenException({ code: 'ROLE_SELF_PERMISSION_ESCALATION', message: 'nope' }), host);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'ROLE_SELF_PERMISSION_ESCALATION', message: 'nope' }),
    );
  });
});

describe('HttpExceptionFilter — Fastify request-parsing errors (GAP-F19-EMPTY-BODY)', () => {
  const fastifyError = (code: string, statusCode: number, message = 'framework detail: SECRET-TOKEN-123') =>
    Object.assign(new Error(message), { code, statusCode });

  it('maps an empty JSON body to 400 VALIDATION_ERROR with a fixed message, not a 500', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, send } = hostFor('c-1');

    filter.catch(fastifyError('FST_ERR_CTP_EMPTY_JSON_BODY', 400), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'The request body must not be empty when the content type is application/json.',
      correlationId: 'c-1',
    });
  });

  it('maps an unsupported media type to 415 and an oversized body to 413', () => {
    const filter = new HttpExceptionFilter();
    const media = hostFor();
    filter.catch(fastifyError('FST_ERR_CTP_INVALID_MEDIA_TYPE', 415), media.host);
    expect(media.status).toHaveBeenCalledWith(415);
    expect(media.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type.' }));

    const large = hostFor();
    filter.catch(fastifyError('FST_ERR_CTP_BODY_TOO_LARGE', 413), large.host);
    expect(large.status).toHaveBeenCalledWith(413);
    expect(large.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('an unknown Fastify 4xx keeps its status with a generic message, and never echoes the framework text', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, send } = hostFor();

    filter.catch(fastifyError('FST_ERR_SOMETHING_NEW', 422), host);

    expect(status).toHaveBeenCalledWith(422);
    const body = send.mock.calls[0]?.[0];
    expect(body.message).toBe('The request could not be processed.');
    expect(JSON.stringify(body)).not.toContain('SECRET-TOKEN-123');
  });

  it('does NOT turn a Fastify 5xx, a non-FST error, or a bare status-carrying object into a 4xx', () => {
    const filter = new HttpExceptionFilter();
    for (const exception of [
      fastifyError('FST_ERR_CTP_EMPTY_JSON_BODY', 500),
      fastifyError('ECONNRESET', 400),
      Object.assign(new Error('x'), { statusCode: 400 }),
    ]) {
      const { host, status } = hostFor();
      filter.catch(exception, host);
      expect(status).toHaveBeenCalledWith(500);
    }
  });
});
