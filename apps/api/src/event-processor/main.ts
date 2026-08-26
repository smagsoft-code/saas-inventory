import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { AppModule } from '../app.module';
import { closeEventProcessorPostgresClient } from '../database/event-processor-client';
import { closePostgresClient } from '../database/client';
import { loadEventProcessorConfig } from './event-processor.config';
import { EventProcessorService } from './event-processor.service';

const logger = new Logger('EventProcessor');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Event Processor's own process entry point — a separate deployable from the API
 * (`apps/api/src/main.ts`) and from the Import Worker (`apps/api/src/import-worker/main.ts`),
 * per ADR-0029. `createApplicationContext` (not `create` + `listen`) — this process never serves
 * HTTP (§9, §84), it only drives `EventProcessorService.runOnce()` in a loop.
 *
 * Reuses `AppModule` rather than a hand-maintained parallel module graph, so `EventProcessorModule`
 * and everything it depends on is guaranteed identical to what the API loads. No HTTP route is ever
 * exposed since nothing calls `.listen()`.
 *
 * Deploy as its own container/process (`docker-compose.dev.yml`'s `event-processor` service,
 * `node dist/event-processor/main.js`), with `APP_EVENT_PROCESSOR_DATABASE_URL` set — see
 * `.env.example`. Never run in the same process as the API or the Import Worker.
 */
async function bootstrap(): Promise<void> {
  const config = loadEventProcessorConfig(); // fail fast on a bad EVENT_PROCESSOR_* value (§163)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const service = app.get(EventProcessorService);
  const workerId = getOptionalEnvVar('EVENT_PROCESSOR_ID', `${hostname()}:${String(process.pid)}:${randomUUID()}`);
  logger.log(`Event Processor starting (workerId=${workerId}, pollInterval=${String(config.pollIntervalMs)}ms)`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log('Event Processor shutting down...');
    await app.close();
    await Promise.all([closeEventProcessorPostgresClient(), closePostgresClient()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  while (!shuttingDown) {
    try {
      const claimed = await service.runOnce(workerId);
      if (claimed === 0) {
        await sleep(config.pollIntervalMs);
      }
    } catch (error) {
      logger.error(`Poll cycle failed: ${(error as Error).message}`, (error as Error).stack);
      await sleep(config.pollIntervalMs);
    }
  }
}

if (require.main === module) {
  void bootstrap();
}
