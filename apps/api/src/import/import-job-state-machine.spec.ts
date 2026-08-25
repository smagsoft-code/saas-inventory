import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertTransition, TERMINAL_STATUSES } from './import-job-state-machine';
import type { ImportJobStatus } from './repositories/import-jobs.repository';

describe('import-job-state-machine', () => {
  const legalPaths: Array<[ImportJobStatus, ImportJobStatus]> = [
    ['uploaded', 'mapping'],
    ['uploaded', 'cancelled'],
    ['mapping', 'validating'],
    ['mapping', 'mapping'],
    ['validating', 'ready'],
    ['validating', 'failed'],
    ['validating', 'cancelled'],
    ['ready', 'importing'],
    ['ready', 'mapping'],
    ['ready', 'cancelled'],
    ['importing', 'completed'],
    ['importing', 'completed_with_errors'],
    ['importing', 'failed'],
    ['failed', 'validating'],
    ['failed', 'importing'],
    ['failed', 'cancelled'],
  ];

  it.each(legalPaths)('%s -> %s is allowed', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const illegalPaths: Array<[ImportJobStatus, ImportJobStatus]> = [
    ['uploaded', 'validating'],
    ['uploaded', 'ready'],
    ['uploaded', 'importing'],
    ['mapping', 'ready'],
    ['mapping', 'importing'],
    ['validating', 'importing'],
    ['validating', 'uploaded'],
    ['ready', 'validating'],
    ['ready', 'completed'],
    ['importing', 'ready'],
    ['importing', 'validating'],
    ['completed', 'importing'],
    ['completed', 'mapping'],
    ['completed_with_errors', 'importing'],
    ['cancelled', 'mapping'],
    ['cancelled', 'validating'],
  ];

  it.each(illegalPaths)('%s -> %s is rejected', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });

  it('no terminal status has any legal outgoing transition except failed (which can be retried)', () => {
    for (const status of ['completed', 'completed_with_errors', 'cancelled'] as ImportJobStatus[]) {
      const others: ImportJobStatus[] = ['uploaded', 'mapping', 'validating', 'ready', 'importing', 'completed', 'completed_with_errors', 'failed', 'cancelled'];
      for (const to of others) {
        expect(() => assertTransition(status, to)).toThrow(ConflictException);
      }
    }
  });

  it('TERMINAL_STATUSES includes failed (an ended attempt, even though it is retryable)', () => {
    expect(TERMINAL_STATUSES).toContain('failed');
    expect(TERMINAL_STATUSES).toEqual(expect.arrayContaining(['completed', 'completed_with_errors', 'cancelled']));
  });
});
