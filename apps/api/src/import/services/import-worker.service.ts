import { Injectable, Logger } from '@nestjs/common';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { getImportWorkerDb } from '../../database/import-worker-client';
import type { ClaimedImportJob } from '../repositories/import-worker-claim.repository';
import { ImportWorkerClaimRepository } from '../repositories/import-worker-claim.repository';
import { ImportJobService } from './import-job.service';

function claimBatchSize(): number {
  return Number(getOptionalEnvVar('IMPORT_WORKER_CLAIM_BATCH_SIZE', '5'));
}

/**
 * §22 — the Import Worker's own claim-and-process loop, deployable-agnostic (the actual process
 * entry point is import-worker/main.ts; this class is what it drives). Claims via
 * ImportWorkerClaimRepository (the app_import_worker connection), then processes each claimed job
 * over the normal, per-tenant app_tenant connection by calling the exact same
 * ImportJobService.runValidation/runCommit methods the synchronous HTTP path uses — "no separate
 * write path," reused for real here, not just documented.
 */
@Injectable()
export class ImportWorkerService {
  private readonly logger = new Logger(ImportWorkerService.name);

  constructor(
    private readonly claimRepository: ImportWorkerClaimRepository,
    private readonly importJobService: ImportJobService,
  ) {}

  /** One poll cycle: claim whatever is claimable, process each job, return how many were claimed
   * (0 means the caller can wait a full poll interval before trying again). */
  async pollOnce(workerId: string): Promise<number> {
    const db = getImportWorkerDb();
    const claimed = await this.claimRepository.claimBatch(db, workerId, claimBatchSize());
    for (const job of claimed) {
      await this.processClaimedJob(job);
    }
    return claimed.length;
  }

  private async processClaimedJob(job: ClaimedImportJob): Promise<void> {
    try {
      if (job.status === 'validating') {
        await this.importJobService.runValidation(job.tenantId, job.id, job.createdBy);
      } else {
        await this.importJobService.runCommit(job.tenantId, job.id, job.createdBy);
      }
    } catch (error) {
      // runValidation/runCommit already transition the job to `failed` (+ terminal audit)
      // internally on error — this catch only prevents one job's failure from killing the poll
      // loop itself.
      this.logger.error(`Import job ${job.id} (tenant ${job.tenantId}) failed during ${job.status}: ${(error as Error).message}`, (error as Error).stack);
    }
  }
}
