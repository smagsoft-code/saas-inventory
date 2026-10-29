import { isValidReviewReference } from '../history-manifest';
import { diagnostic, type Diagnostic } from '../types';
import type { LintFinding } from './lint-migration';
import { RULES } from './rules';

/**
 * Exceptions to lint findings (ADR-0041, D-8D): explicit, narrow and reviewable. This module is the mechanism only — NO
 * exceptions file exists in the repository and the wrapper loads none. A proposal for the file format is in the D-8D report.
 *
 * An exception accepts exactly ONE finding: the rule, the migration, the content hash of the migration file and the line must
 * all match. It never removes the finding: the report keeps it, marked as accepted, with the reason and the review reference.
 * So an exception cannot hide the statement it justifies, and it stops applying the moment the file changes (its hash no longer
 * matches). Wildcards do not exist. Rules that make a file unanalysable (parse errors, transaction control) cannot be excepted.
 */

export interface LintException {
  readonly ruleId: string;
  readonly tag: string;
  /** Canonical SHA-256 of the migration file the exception was reviewed against (the history manifest's value). */
  readonly sha256: string;
  readonly line: number;
  readonly reason: string;
  readonly reviewedIn: string;
}

export const MIN_REASON_LENGTH = 30;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ExceptionResult {
  readonly findings: readonly LintFinding[];
  /** Problems with the exceptions themselves; any of them means the exception list must not be trusted. */
  readonly problems: readonly Diagnostic[];
}

export function applyExceptions(
  findings: readonly LintFinding[],
  exceptions: readonly LintException[],
  fileHashes: Readonly<Record<string, string | null | undefined>>,
): ExceptionResult {
  const problems: Diagnostic[] = [];
  const bad = (message: string, tag?: string) => problems.push(diagnostic('LINT_EXCEPTION_INVALID', message, tag === undefined ? {} : { migration: tag }));
  const seen = new Set<string>();
  const accepted = new Map<LintFinding, LintException>();

  for (const [index, ex] of exceptions.entries()) {
    const label = `Exception #${index + 1} (${typeof ex.ruleId === 'string' ? ex.ruleId : '?'}${typeof ex.tag === 'string' ? ` in ${ex.tag}` : ''})`;
    if (typeof ex.ruleId !== 'string' || ex.ruleId === '' || ex.ruleId.includes('*')) {
      bad(`${label}: a rule id is required and wildcards are not allowed.`);
      continue;
    }
    const info = RULES[ex.ruleId];
    if (info === undefined) {
      bad(`${label}: unknown rule.`);
      continue;
    }
    if (!info.exceptable) {
      bad(`${label}: this rule cannot be excepted (it means the file cannot be analysed or the batch transaction would be broken).`, ex.tag);
      continue;
    }
    if (typeof ex.tag !== 'string' || ex.tag === '' || ex.tag.includes('*')) {
      bad(`${label}: a migration tag is required and wildcards are not allowed.`);
      continue;
    }
    if (!Number.isInteger(ex.line) || ex.line < 1) {
      bad(`${label}: an exact line number is required (an exception covers one statement, not a file).`, ex.tag);
      continue;
    }
    if (typeof ex.sha256 !== 'string' || !SHA256_HEX.test(ex.sha256)) {
      bad(`${label}: the sha256 of the reviewed file is required.`, ex.tag);
      continue;
    }
    if (typeof ex.reason !== 'string' || ex.reason.trim().length < MIN_REASON_LENGTH) {
      bad(`${label}: a reason of at least ${MIN_REASON_LENGTH} characters is required.`, ex.tag);
      continue;
    }
    if (typeof ex.reviewedIn !== 'string' || !isValidReviewReference(ex.reviewedIn)) {
      bad(`${label}: "reviewedIn" must be commit:<sha>, pr:<n>, review:<id>:<date> or retroactive-review:<id>:<date>.`, ex.tag);
      continue;
    }
    const current = fileHashes[ex.tag];
    if (current === undefined || current === null) {
      bad(`${label}: the migration is not in the journal.`, ex.tag);
      continue;
    }
    if (current !== ex.sha256) {
      bad(`${label}: stale — the file changed after the exception was reviewed (its hash no longer matches).`, ex.tag);
      continue;
    }
    const identity = `${ex.ruleId}|${ex.tag}|${ex.line}`;
    if (seen.has(identity)) {
      bad(`${label}: duplicated.`, ex.tag);
      continue;
    }
    seen.add(identity);
    const target = findings.find((f) => !accepted.has(f) && f.ruleId === ex.ruleId && f.tag === ex.tag && f.line === ex.line);
    if (target === undefined) {
      bad(`${label}: matches no finding (rule, migration and line must all match) — remove it.`, ex.tag);
      continue;
    }
    accepted.set(target, ex);
  }

  const out = findings.map((f) => {
    const ex = accepted.get(f);
    return ex === undefined ? f : { ...f, accepted: { reason: ex.reason, reviewedIn: ex.reviewedIn } };
  });
  return { findings: out, problems };
}
