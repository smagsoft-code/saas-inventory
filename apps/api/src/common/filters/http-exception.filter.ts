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
    return { statusCode: status, code: extractCode(exception) ?? codeForStatus(status), message: extractMessage(exception) };
  }
  const fastifyClientError = resolveFastifyClientError(exception);
  if (fastifyClientError) {
    return fastifyClientError;
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}

/** Fixed, safe messages for the framework's own request-parsing errors — never the framework's text. */
const FASTIFY_CLIENT_ERROR_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_EMPTY_JSON_BODY: 'The request body must not be empty when the content type is application/json.',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Unsupported media type.',
  FST_ERR_CTP_BODY_TOO_LARGE: 'The request body is too large.',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'The request body does not match its declared length.',
};

/**
 * GAP-F19-EMPTY-BODY. Fastify raises its own errors (`FST_ERR_CTP_*`: empty JSON body, unsupported
 * media type, body too large, …) BEFORE any controller runs. They are plain `FastifyError`s with a
 * 4xx `statusCode`, not Nest `HttpException`s, so they used to fall through to the generic branch
 * and be answered `500 INTERNAL_ERROR` — a client mistake reported as a server fault (and logged at
 * error level). Map them to their real 4xx status in the standard envelope, with a fixed message:
 * the framework's own text is never echoed. Anything that is not a Fastify 4xx stays a 500.
 */
function resolveFastifyClientError(exception: unknown): { statusCode: number; code: string; message: string } | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { code, statusCode } = exception as { code?: unknown; statusCode?: unknown };
  if (typeof code !== 'string' || !code.startsWith('FST_')) return undefined;
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) return undefined;
  return {
    statusCode,
    code: codeForStatus(statusCode),
    message: FASTIFY_CLIENT_ERROR_MESSAGES[code] ?? 'The request could not be processed.',
  };
}

/** Most exceptions rely on the generic per-status `code` from `codeForStatus` below. A caller that
 * needs a specific, greppable machine code for one particular business rule (distinct from every
 * other 403/409 in the system) can throw e.g. `new ForbiddenException({ code: 'SOME_CODE', message:
 * '...' })` — the object body form `HttpException` already accepts — and it wins over the generic
 * default. Never required; most `ForbiddenException('...')` calls in this codebase pass a plain
 * string and get the generic `FORBIDDEN` code unchanged. */
function extractCode(exception: HttpException): string | undefined {
  const body = exception.getResponse();
  if (body && typeof body === 'object' && 'code' in body && typeof (body as { code: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  return undefined;
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
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'PAYLOAD_TOO_LARGE';
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_ERROR' : 'ERROR';
  }
}
