import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
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
function registerCorrelationId(app: NestFastifyApplication): void {
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRequest', (request, reply, done) => {
    const incoming = request.headers['correlation-id'];
    const correlationId = typeof incoming === 'string' && incoming.trim() !== '' ? incoming : randomUUID();
    request.correlationId = correlationId;
    void reply.header('Correlation-Id', correlationId);
    done();
  });
}

/**
 * All process-wide app configuration in one place, shared between the real `bootstrap()` below
 * and the integration test suite (test/auth/*.integration.test.ts), which needs the exact same
 * cookie/versioning/validation setup but calls `app.init()` instead of `app.listen()` — extracted
 * so the two paths can never drift apart.
 */
export async function buildApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  await app.register(helmet);
  await app.register(fastifyCookie);

  registerCorrelationId(app);

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
  // and are depended on as-is (container healthchecks, Caddy).
  app.setGlobalPrefix('api', { exclude: ['health', 'docs', 'docs/(.*)'] });
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
