import { Module } from '@nestjs/common';
import { EventClaimRepository } from './event-claim.repository';
import { EventDispatcher } from './event-dispatcher.service';
import { EVENT_HANDLERS } from './event-delivery.port';
import { EventProcessorService } from './event-processor.service';

/**
 * NOTIFICATIONS — the Event Processor (events.md, ADR-0010). Providers only, no controllers: it
 * exposes no HTTP surface (§82, §83). Added to `AppModule` so the separate deployable
 * (`event-processor/main.ts`) can `NestFactory.createApplicationContext(AppModule)` and
 * `app.get(EventProcessorService)` without a parallel module graph — exactly how `ImportModule`
 * supports the Import Worker. The main API process loads this module but never drives the loop.
 *
 * `EVENT_HANDLERS` is bound to `[]`: **FASE 14 registers no production delivery handler** (§60,
 * §61). The delivery port exists and is ready; FASE 15 replaces this binding with an n8n-webhook
 * adapter. Until then nothing is claimable and no event can be falsely marked delivered (§63,
 * §119).
 *
 * Consumed by nothing else in the backend (modules.md#notifications) — no other module imports this.
 */
@Module({
  providers: [
    EventClaimRepository,
    EventDispatcher,
    EventProcessorService,
    { provide: EVENT_HANDLERS, useValue: [] },
  ],
  exports: [EventProcessorService, EventDispatcher],
})
export class EventProcessorModule {}
