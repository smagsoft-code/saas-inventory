import { Logger, Module } from '@nestjs/common';
import { EventClaimRepository } from './event-claim.repository';
import { EventDispatcher } from './event-dispatcher.service';
import { EVENT_HANDLERS, type EventHandler } from './event-delivery.port';
import { EventProcessorService } from './event-processor.service';
import { buildN8nEventHandlers } from './n8n/n8n-event-delivery';
import { loadN8nDeliveryConfig } from './n8n/n8n-delivery.config';

/**
 * NOTIFICATIONS — the Event Processor (events.md, ADR-0010/ADR-0011/ADR-0012). Providers only, no
 * controllers: it exposes no HTTP surface. Added to `AppModule` so the separate deployable
 * (`event-processor/main.ts`) can `NestFactory.createApplicationContext(AppModule)` and
 * `app.get(EventProcessorService)` without a parallel module graph — exactly how `ImportModule`
 * supports the Import Worker. The main API process loads this module but never drives the loop.
 *
 * FASE 15 binds `EVENT_HANDLERS` from configuration:
 *  - `N8N_EVENTS_ENABLED=false` (default) → `[]`: no handler registered, so `supportedTypes()` is
 *    empty, nothing is claimed, and every event stays `pending` (§20, §84).
 *  - `N8N_EVENTS_ENABLED=true` → one handler per known event type, each forwarding the claimed
 *    envelope to n8n over authenticated HTTPS. `loadN8nDeliveryConfig()` throws here if the URL or
 *    secret is missing/insecure, so a misconfigured processor fails at startup rather than running
 *    without delivering (§21, §85).
 *
 * The Telegram bot token lives only in n8n's credential store — never here (ADR-0012).
 */
@Module({
  providers: [
    EventClaimRepository,
    EventDispatcher,
    EventProcessorService,
    {
      provide: EVENT_HANDLERS,
      useFactory: (): EventHandler[] => {
        const logger = new Logger('EventProcessorModule');
        const config = loadN8nDeliveryConfig();
        if (!config.enabled) {
          logger.log('n8n event delivery is DISABLED (N8N_EVENTS_ENABLED=false) — events stay pending');
          return [];
        }
        const handlers = buildN8nEventHandlers(config);
        logger.log(`n8n event delivery is ENABLED — ${String(handlers.length)} event type(s) registered (secret redacted)`);
        return handlers;
      },
    },
  ],
  exports: [EventProcessorService, EventDispatcher],
})
export class EventProcessorModule {}
