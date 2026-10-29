import { isValidReviewReference } from '../history-manifest';
import { diagnostic, type Diagnostic } from '../types';
import { MIN_REASON_LENGTH, type LintException } from './exceptions';

/**
 * `database/migrations/sql-lint-exceptions.json` — the reviewed list of lint findings that a human accepted (ADR-0041, D-8D.1).
 *
 *   { "schemaVersion": 1, "exceptions": [ { "ruleId", "tag", "sha256", "line", "reason", "reviewedIn" } ] }
 *
 * Shape rules (this module; the meaning of an entry — does it match a real finding? — is `applyExceptions`):
 *  - exactly the two top-level keys above, exactly the six entry keys; any other key is refused;
 *  - no wildcards, no empty fields, no duplicate (rule, migration, line);
 *  - the file is STRICT: one bad entry invalidates the whole file, nothing is "partly" applied.
 *
 * Absent file = no exceptions, by definition: exceptions can only relax the linter, so losing the file can only make it
 * stricter and the accepted findings reappear as open ones. A file that is present but invalid stops the run.
 * The repository ships it EMPTY; no exception exists for the historical migrations.
 */

export const SQL_LINT_EXCEPTIONS_FILE = 'sql-lint-exceptions.json';
export const SQL_LINT_EXCEPTIONS_SCHEMA_VERSION = 1;

const TOP_KEYS = ['schemaVersion', 'exceptions'] as const;
const ENTRY_KEYS = ['ruleId', 'tag', 'sha256', 'line', 'reason', 'reviewedIn'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseLintExceptions(text: string): { exceptions: LintException[] | null; problems: Diagnostic[] } {
  const problems: Diagnostic[] = [];
  const bad = (message: string, tag?: string) => problems.push(diagnostic('LINT_EXCEPTION_INVALID', `${SQL_LINT_EXCEPTIONS_FILE}: ${message}`, tag === undefined ? {} : { migration: tag }));

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    bad('not valid JSON.');
    return { exceptions: null, problems };
  }
  if (!isRecord(raw)) {
    bad('the top level must be an object.');
    return { exceptions: null, problems };
  }
  for (const key of Object.keys(raw)) if (!(TOP_KEYS as readonly string[]).includes(key)) bad(`unknown top-level field "${key}".`);
  if (raw['schemaVersion'] !== SQL_LINT_EXCEPTIONS_SCHEMA_VERSION) bad(`"schemaVersion" must be ${SQL_LINT_EXCEPTIONS_SCHEMA_VERSION}.`);
  const entries = raw['exceptions'];
  if (!Array.isArray(entries)) {
    bad('"exceptions" must be an array (an empty array is valid).');
    return { exceptions: null, problems };
  }

  const out: LintException[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    const label = `entry #${i + 1}`;
    if (!isRecord(entry)) {
      bad(`${label}: must be an object.`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!(ENTRY_KEYS as readonly string[]).includes(key)) bad(`${label}: unknown field "${key}".`);
    for (const key of ENTRY_KEYS) if (!(key in entry)) bad(`${label}: missing field "${key}" (every entry names its rule, migration, line, file hash, reason and review).`);
    const { ruleId, tag, sha256, line, reason, reviewedIn } = entry;
    const where = typeof tag === 'string' ? tag : undefined;
    if (typeof ruleId !== 'string' || ruleId.trim() === '' || ruleId.includes('*')) bad(`${label}: "ruleId" must be one exact rule id (no wildcard, not empty).`, where);
    if (typeof tag !== 'string' || tag.trim() === '' || tag.includes('*')) bad(`${label}: "tag" must be one exact migration tag (no wildcard, not empty).`);
    if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) bad(`${label}: "sha256" must be 64 lowercase hex characters.`, where);
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) bad(`${label}: "line" must be an integer ≥ 1 (an exception covers one statement).`, where);
    if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) bad(`${label}: "reason" must have at least ${MIN_REASON_LENGTH} characters.`, where);
    if (typeof reviewedIn !== 'string' || !isValidReviewReference(reviewedIn)) bad(`${label}: "reviewedIn" must be commit:<sha>, pr:<n>, review:<id>:<date> or retroactive-review:<id>:<date>.`, where);
    if (typeof ruleId === 'string' && typeof tag === 'string' && typeof line === 'number') {
      const identity = `${ruleId}|${tag}|${line}`;
      if (seen.has(identity)) bad(`${label}: duplicate of an earlier entry (same rule, migration and line).`, where);
      seen.add(identity);
    }
    if (
      typeof ruleId === 'string' && typeof tag === 'string' && typeof sha256 === 'string' && typeof line === 'number' &&
      typeof reason === 'string' && typeof reviewedIn === 'string'
    ) {
      out.push({ ruleId, tag, sha256, line, reason, reviewedIn });
    }
  }
  return problems.length > 0 ? { exceptions: null, problems } : { exceptions: out, problems: [] };
}
