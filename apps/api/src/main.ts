import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { getOptionalEnvVar } from '@saas-inventory/config';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Every request gets a Correlation-Id — from the client's own header if it sent one, generated
 * otherwise (api.md#correlation-id). Registered as a raw Fastify hook (not NestJS middleware) so
 * it runs before any guard and the value is available on the actual FastifyRequest object guards/
 * filters read from, not a wrapped copy.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerCorrelationId(app: NestFastifyApplication): void {
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRequest', (request, reply, done) => {
    const incoming = request.headers['correlation-id'];
    // Only a UUID is accepted from the client: `correlation_id` is a uuid column on several tables
    // (orders, event_outbox, audit_log, ...), so any other string — e.g. the browser fallback id
    // `web-<time>-<random>` it used to send over plain http — made those inserts fail with a 500
    // ("invalid input syntax for type uuid"). Anything else is replaced by a fresh UUID.
    const correlationId = typeof incoming === 'string' && UUID_PATTERN.test(incoming.trim()) ? incoming.trim() : randomUUID();
    request.correlationId = correlationId;
    void reply.header('Correlation-Id', correlationId);
    done();
  });
}

/**
 * GAP-F19-EMPTY-BODY. Fastify's stock JSON parser answers a request that declares
 * `Content-Type: application/json` but carries NO body with `FST_ERR_CTP_EMPTY_JSON_BODY` — which
 * made every bodyless action POST (`confirm`, `cancel`, `approve`, platform `suspend`, …) fail for
 * any client that sends that header by default (curl `-H`, n8n/Postman HTTP nodes). An empty (or
 * whitespace-only) body is now read as "no body" (`undefined`):
 *  - an action with no body DTO simply runs;
 *  - an endpoint that REQUIRES a body still rejects it — the global `ValidationPipe` turns the
 *    missing body into the DTO's per-field `400 VALIDATION_ERROR`, so nothing is silently accepted;
 *  - a non-empty body goes through Fastify's own default parser unchanged (same prototype-poisoning
 *    protections, same 400 on malformed JSON), and the body-size limit is unchanged.
 * `useBodyParser` is Nest's supported hook: it also stops `app.init()` from overriding this parser.
 */
function registerLenientJsonBody(adapter: FastifyAdapter): void {
  const fastify = adapter.getInstance();
  const { bodyLimit, onProtoPoisoning, onConstructorPoisoning } = fastify.initialConfig;
  const defaultJsonParser = fastify.getDefaultJsonParser(onProtoPoisoning ?? 'error', onConstructorPoisoning ?? 'error');
  adapter.useBodyParser('application/json', false, bodyLimit === undefined ? {} : { bodyLimit }, (request, body, done) => {
    const text = body.toString('utf8');
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    defaultJsonParser(request, text, done);
  });
}

/**
 * All process-wide app configuration in one place, shared between the real `bootstrap()` below
 * and the integration test suite (test/auth/*.integration.test.ts), which needs the exact same
 * cookie/versioning/validation setup but calls `app.init()` instead of `app.listen()` — extracted
 * so the two paths can never drift apart.
 */
export async function buildApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  await app.register(helmet);
  await app.register(fastifyCookie);
  // security.md#file-upload-security / IMPORT_MAX_FILE_SIZE_BYTES (Prompt 10) — the plugin itself
  // rejects an oversized upload before ImportFileService ever sees the buffer; ImportFileService's
  // own size check stays too, as the actual documented contract (this limit is a hard backstop,
  // not the source of truth for the error message).
  await app.register(fastifyMultipart, {
    limits: { fileSize: Number(getOptionalEnvVar('IMPORT_MAX_FILE_SIZE_BYTES', '26214400')), files: 1 },
  });

  registerCorrelationId(app);
  registerLenientJsonBody(adapter);

  const corsOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  // api.md#versioning's decision, applied now that a real endpoint (auth) exists to version.
  // health/docs are excluded — they were already scaffolded unprefixed/unversioned in Prompt 00
  // and are depended on as-is (container healthchecks, Caddy). `q/(.*)` (Prompt 09) is excluded the
  // same way, for the same reason: api.md#public-endpoints documents the QR public resolver's route
  // literally as `GET /q/:code`, meant to be embedded in a physical, printed QR image — baking
  // `/api/v1/` into a URL printed on a label that outlives any one API version would be a worse
  // contract than a stable, unprefixed, version-neutral one (health.controller.ts's own
  // @Version(VERSION_NEUTRAL) precedent, applied here to a second route for the same reason).
  app.setGlobalPrefix('api', { exclude: ['health', 'docs', 'docs/(.*)', 'q/(.*)'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SaaS Inventory API')
    .setDescription('REST API for the multi-tenant inventory management SaaS')
    .setVersion('0.0.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  return app;
}

async function bootstrap(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env['PORT'] ?? 4000);
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
