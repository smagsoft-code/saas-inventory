import type { ArgumentsHost} from '@nestjs/common';
import { Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorShape } from '@saas-inventory/types';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The single global exception filter (backend.md#cross-cutting-concerns) — every thrown error,
 * from every module, is mapped to the one error envelope shape api.md#errors defines
 * (packages/types' ApiErrorShape, unused until this phase's first real endpoints). Never leaks a
 * raw exception message, stack trace, or SQL error to the client (security.md) — a 5xx gets a
 * fixed generic message and its detail goes to the server log only, keyed by correlationId so
 * support can still find it.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = request.correlationId;

    const { statusCode, code, message } = resolve(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`[${correlationId}] ${detail}`);
    }

    const body: ApiErrorShape = { statusCode, code, message, correlationId };
    void response.status(statusCode).send(body);
  }
}

function resolve(exception: unknown): { statusCode: number; code: string; message: string } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { statusCode: status, code: codeForStatus(status), message: extractMessage(exception) };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}

function extractMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const raw = (body as { message: unknown }).message;
    // class-validator's ValidationPipe throws a BadRequestException whose `message` is an array
    // of per-field validation strings — flatten it into one readable sentence.
    return Array.isArray(raw) ? raw.join(' ') : String(raw);
  }
  return exception.message;
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_ERROR' : 'ERROR';
  }
}
