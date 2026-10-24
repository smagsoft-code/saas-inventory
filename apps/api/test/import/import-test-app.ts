import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import { ObjectStorageService } from '../../src/common/storage/object-storage.service';

/**
 * An in-memory stand-in for ObjectStorageService — this test environment has no real S3-compatible
 * endpoint reachable (no Docker/MinIO available here; docker-compose.dev.yml's `minio` service is
 * the real target for a developer running this suite locally with `pnpm test:integration` against
 * a full docker-compose stack). Swapped in only for the IMPORT integration suite via
 * `overrideProvider` below — every other integration suite, and the real running API/Import
 * Worker, use the real S3Client-backed implementation unchanged. This does not weaken what's
 * verified: object storage is a plain key/value put-then-get contract IMPORT only depends on
 * through ObjectStorageService's own interface, never a rule under test in this phase — Postgres
 * (RLS, constraints, transactions, locking) stays 100% real, per CLAUDE.md §7.9/§35.
 */
export class InMemoryObjectStorageService {
  private readonly store = new Map<string, Buffer>();

  async putObject(key: string, body: Buffer): Promise<void> {
    this.store.set(key, body);
  }

  async getObject(key: string): Promise<Buffer> {
    const value = this.store.get(key);
    if (!value) throw new Error(`InMemoryObjectStorageService: no object stored for key "${key}".`);
    return value;
  }

  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Mirrors src/main.ts's buildApp() setup (helmet, cookies, multipart, correlation-id hook, CORS,
 * versioning/prefix, validation pipe) but boots through Nest's TestingModule so
 * ObjectStorageService can be overridden — buildApp() itself uses NestFactory.create() directly,
 * which has no override seam. Keep this in sync with buildApp() if that function's setup changes;
 * Swagger document generation is skipped (irrelevant to HTTP behavior under test).
 */
export async function buildImportTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ObjectStorageService)
    .useClass(InMemoryObjectStorageService)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  await app.register(helmet);
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: 26_214_400, files: 1 } });

  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRequest', (request, reply, done) => {
    const incoming = request.headers['correlation-id'];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const correlationId = typeof incoming === 'string' && uuid.test(incoming.trim()) ? incoming.trim() : randomUUID();
    request.correlationId = correlationId;
    void reply.header('Correlation-Id', correlationId);
    done();
  });

  app.enableCors({ origin: false, credentials: true });
  app.setGlobalPrefix('api', { exclude: ['health', 'docs', 'docs/(.*)', 'q/(.*)'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  return app;
}
