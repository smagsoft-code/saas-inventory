import { Injectable, Logger } from '@nestjs/common';
import { getEventProcessorDb, type EventProcessorDatabase } from '../database/event-processor-client';
import type { ClaimedEvent } from './event-claim.repository';
import { EventClaimRepository } from './event-claim.repository';
import { EventDispatcher } from './event-dispatcher.service';
import { loadEventProcessorConfig } from './event-processor.config';
import { sanitizeError } from './error-sanitizer';
import { nextRetryDelayMs } from './retry-policy';

/**
 * The Event Processor's claim-and-dispatch cycle (§9, §160), deployable-agnostic — the actual
 * process entry point is `event-processor/main.ts`; this class is what it drives, and what the
 * integration tests drive directly. Split into a single `runOnce()` (testable) and, in `main.ts`,
 * the infinite poll loop around it.
 *
 * Separate from the Import Worker in every way that matters (ADR-0029): its own entry point, its own
 * `app_event_processor` DB connection, its own claim repository. It only shares the technical
 * pattern (`FOR UPDATE SKIP LOCKED`, stale-claim recovery, polling).
 */
@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    private readonly claimRepository: EventClaimRepository,
    private readonly dispatcher: EventDispatcher,
  ) {}

  /**
   * One poll cycle: reap exhausted stale claims, then claim a batch and dispatch each event,
   * marking the outcome. Returns how many were claimed (0 → the caller may wait a full poll
   * interval before trying again). A failure on one event never aborts the batch or the loop
   * (§57, §162).
   */
  async runOnce(workerId: string): Promise<number> {
    const config = loadEventProcessorConfig();
    const supportedTypes = this.dispatcher.supportedTypes();

    // No registered handler → nothing can be claimed and nothing this processor could have left
    // `processing`, so it stays completely idle (no DB writes) — no event is ever marked
    // `delivered` without a real delivery (§61, §63, §119). FASE 14 production is always this case.
    if (supportedTypes.length === 0) {
      return 0;
    }

    const db = getEventProcessorDb();
    await this.claimRepository.reapStale(db, config);
    const claimed = await this.claimRepository.claimBatch(db, workerId, supportedTypes, config);
    if (claimed.length > 0) {
      this.logger.log(`claimed ${String(claimed.length)} event(s) (workerId=${workerId})`);
    }
    for (const event of claimed) {
      await this.processOne(db, event, config.maxAttempts);
    }
    return claimed.length;
  }

  private async processOne(db: EventProcessorDatabase, event: ClaimedEvent, maxAttempts: number): Promise<void> {
    // Logs carry eventId / eventType / tenantId / attempt / status only — never the payload or any
    // PII (§33, §161, §194).
    const label = `event ${event.id} (${event.eventType}, tenant=${event.tenantId ?? 'platform'})`;
    try {
      const outcome = await this.dispatcher.dispatch(event.payload);
      if (outcome.kind === 'delivered') {
        await this.claimRepository.markDelivered(db, event.id);
        this.logger.log(`${label} delivered`);
        return;
      }
      if (outcome.kind === 'terminal') {
        await this.claimRepository.markTerminal(db, event.id, sanitizeError(outcome.error));
        this.logger.warn(`${label} dead-lettered (terminal): ${sanitizeError(outcome.error)}`);
        return;
      }
      const config = loadEventProcessorConfig();
      await this.claimRepository.markFailed(db, event.id, sanitizeError(outcome.error), maxAttempts);
      const willDeadLetter = event.attempts + 1 >= maxAttempts;
      this.logger.warn(
        willDeadLetter
          ? `${label} dead-lettered after ${String(event.attempts + 1)} attempts: ${sanitizeError(outcome.error)}`
          : `${label} attempt ${String(event.attempts + 1)} failed, retry in ~${String(nextRetryDelayMs(event.attempts + 1, config))}ms: ${sanitizeError(outcome.error)}`,
      );
    } catch (error) {
      // Infrastructure error while marking the outcome (e.g. DB blip). Leave the row `processing` —
      // stale reclaim will pick it up. Do not let one event kill the poll loop.
      this.logger.error(`${label} could not be finalised: ${sanitizeError(error)}`);
    }
  }
}
