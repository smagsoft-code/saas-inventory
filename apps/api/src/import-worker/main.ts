import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { AppModule } from '../app.module';
import { closeImportWorkerPostgresClient } from '../database/import-worker-client';
import { closePostgresClient } from '../database/client';
import { ImportWorkerService } from '../import/services/import-worker.service';

const logger = new Logger('ImportWorker');

function pollIntervalMs(): number {
  return Number(getOptionalEnvVar('IMPORT_WORKER_POLL_INTERVAL_MS', '2000'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * §22/ADR-0029 — the Import Worker's own process entry point, a separate deployable from the API
 * (`apps/api/src/main.ts`) and, once built, from the Event Processor. `createApplicationContext`
 * (not `create` + `listen`) — this process never serves HTTP, it only drives
 * ImportWorkerService.pollOnce() in a loop. Reuses AppModule rather than a parallel, hand-maintained
 * module graph so ImportModule's wiring (and everything it depends on — CatalogModule/
 * InventoryModule/CommonModule/DatabaseModule) is guaranteed identical to the API's own; no HTTP
 * route is ever exposed since nothing calls `.listen()`.
 *
 * Deploy as its own container/process (infrastructure/docker's import-worker service,
 * `node dist/import-worker/main.js`), with `APP_IMPORT_WORKER_DATABASE_URL` set — see
 * .env.example. Never run this in the same process as `apps/api/src/main.ts` or a future Event
 * Processor (ADR-0029's explicit separation).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const workerService = app.get(ImportWorkerService);
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  logger.log(`Import Worker starting (workerId=${workerId}, pollInterval=${pollIntervalMs()}ms)`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log('Import Worker shutting down...');
    await app.close();
    await Promise.all([closeImportWorkerPostgresClient(), closePostgresClient()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  while (!shuttingDown) {
    try {
      const claimed = await workerService.pollOnce(workerId);
      if (claimed === 0) {
        await sleep(pollIntervalMs());
      }
    } catch (error) {
      logger.error(`Poll cycle failed: ${(error as Error).message}`, (error as Error).stack);
      await sleep(pollIntervalMs());
    }
  }
}

if (require.main === module) {
  void bootstrap();
}
