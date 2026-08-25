import { ConflictException } from '@nestjs/common';
import type { ImportJobStatus } from './repositories/import-jobs.repository';

/**
 * §10 — the exact fixed state set (database.md's `import_jobs_status_check`), enforced as a
 * controlled state machine (§10: "no permitir transiciones arbitrarias desde cualquier endpoint").
 * `failed` can resume into either `validating` or `importing` — ImportJobService decides which,
 * based on whether the job had already reached `ready` (validation complete) before failing; both
 * edges are legal here, the service picks the right one for the specific job's history.
 */
const ALLOWED_TRANSITIONS: Record<ImportJobStatus, ImportJobStatus[]> = {
  uploaded: ['mapping', 'cancelled'],
  mapping: ['mapping', 'validating', 'cancelled'],
  validating: ['ready', 'failed', 'cancelled'],
  ready: ['importing', 'mapping', 'cancelled'],
  importing: ['completed', 'completed_with_errors', 'failed'],
  completed: [],
  completed_with_errors: [],
  failed: ['validating', 'importing', 'cancelled'],
  cancelled: [],
};

export function assertTransition(from: ImportJobStatus, to: ImportJobStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ConflictException(`Import job cannot move from "${from}" to "${to}".`);
  }
}

/** The four states this attempt can end on — §27's "audit the terminal states" set. `failed` is
 * included even though it can still be retried (ALLOWED_TRANSITIONS above): each attempt that ends
 * in `failed` gets its own audit entry, same as a successful one. */
export const TERMINAL_STATUSES: ImportJobStatus[] = ['completed', 'completed_with_errors', 'failed', 'cancelled'];
