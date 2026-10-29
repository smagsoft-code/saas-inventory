import { validateJournal } from './journal-validator';
import {
  diagnostic,
  type Diagnostic,
  type FileHashes,
  type JournalEntry,
  type RegistryHashCandidates,
  type RegistryRow,
  type RegistryState,
} from './types';

/**
 * Classifies the state of `drizzle.__drizzle_migrations` against the journal (ADR-0041, decision 5).
 *
 * It does not count rows to decide. Drizzle itself only looks at the row with the highest
 * `created_at`; this classifier requires the registry to be an EXACT PREFIX of the journal — row `i`
 * has the `created_at` of journal entry `i` and the hash of its file — and treats every other shape
 * as inconsistent. It never repairs; an inconsistent result means "abort with these diagnostics".
 *
 * Inputs are plain facts the caller read (read-only) from the database and the file system, so the
 * logic is testable without either.
 */

export type HistoryState =
  /** No migration applied and no application tables: a database to bootstrap. */
  | 'NEW'
  /** The registry is a valid prefix of the journal (possibly the whole journal). */
  | 'CONSISTENT'
  /** Anything else. `diagnostics` says why. */
  | 'INCONSISTENT';

export interface ClassificationInput {
  readonly journal: readonly JournalEntry[];
  readonly fileHashes: FileHashes;
  /** What Drizzle could have registered for each file's current content (see `hash.ts`). */
  readonly registryHashCandidates: RegistryHashCandidates;
  readonly registry: RegistryState;
  /** Tables in schema `public` (the application schema). */
  readonly publicTableCount: number;
  /** Tags the privileged manifest declares; used to name a skipped privileged migration. */
  readonly privilegedTags?: ReadonlySet<string>;
}

export interface HistoryClassification {
  readonly state: HistoryState;
  /** Number of journal entries recorded as applied (the registry's length when consistent). */
  readonly appliedCount: number;
  /** Journal entries still to run; empty when the database is up to date or when inconsistent. */
  readonly pending: readonly JournalEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** `created_at` is a bigint column; postgres.js returns it as a string. Returns null if unusable. */
export function parseCreatedAt(value: string | number | bigint): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function classifyHistory(input: ClassificationInput): HistoryClassification {
  const { journal, fileHashes, registry, publicTableCount } = input;
  const privileged = input.privilegedTags ?? new Set<string>();

  const journalProblems = validateJournal(journal, fileHashes);
  if (journalProblems.length > 0) {
    return { state: 'INCONSISTENT', appliedCount: 0, pending: [], diagnostics: journalProblems };
  }

  if (registry.kind === 'absent' || registry.rows.length === 0) {
    if (publicTableCount > 0) {
      const code = registry.kind === 'absent' ? 'REGISTRY_MISSING_WITH_TABLES' : 'REGISTRY_EMPTY_WITH_TABLES';
      return {
        state: 'INCONSISTENT',
        appliedCount: 0,
        pending: [],
        diagnostics: [
          diagnostic(
            code,
            `The migration registry is ${registry.kind === 'absent' ? 'missing' : 'empty'} but ${publicTableCount} table(s) exist in schema "public". Refusing to run: the database does not match its history.`,
            { details: { publicTableCount } },
          ),
        ],
      };
    }
    return { state: 'NEW', appliedCount: 0, pending: journal, diagnostics: [] };
  }

  const rows = registry.rows;
  const out: Diagnostic[] = [];

  if (publicTableCount === 0) {
    out.push(
      diagnostic('REGISTRY_WITHOUT_TABLES', `The registry has ${rows.length} row(s) but schema "public" has no tables.`, {
        details: { registryRows: rows.length },
      }),
    );
  }

  if (rows.length > journal.length) {
    for (const [position, row] of rows.entries()) {
      if (position >= journal.length) {
        out.push(
          diagnostic(
            'REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY',
            `Registry row ${position} (created_at ${row.createdAt}) has no journal entry.`,
            { details: { position, createdAt: row.createdAt } },
          ),
        );
      }
    }
  }

  const compared = Math.min(rows.length, journal.length);
  for (let i = 0; i < compared; i += 1) {
    const row = rows[i] as RegistryRow;
    const entry = journal[i] as JournalEntry;
    if (!Number.isSafeInteger(row.createdAt) || row.createdAt <= 0) {
      out.push(diagnostic('REGISTRY_ROW_INVALID', `Registry row ${i} has an unusable created_at.`, { details: { position: i } }));
      continue;
    }
    if (row.createdAt !== entry.when) {
      const skippedLater = journal.findIndex((e, j) => j > i && e.when === row.createdAt);
      if (skippedLater >= 0) {
        const skipped = journal.slice(i, skippedLater).map((e) => e.tag);
        out.push(
          diagnostic(
            'HISTORY_MISSING_APPLIED_MIGRATION',
            `Registry row ${i} matches "${(journal[skippedLater] as JournalEntry).tag}" but ${skipped.join(', ')} should have been applied before it and is not recorded.`,
            { details: { position: i, skipped: skipped.join(', ') } },
          ),
        );
        for (const tag of skipped) {
          if (privileged.has(tag)) {
            out.push(
              diagnostic('PRIVILEGED_MIGRATION_MISSING_FROM_HISTORY', `Privileged migration "${tag}" is not recorded as applied although later migrations are.`, {
                migration: tag,
              }),
            );
          }
        }
      } else {
        out.push(
          diagnostic('HISTORY_NOT_PREFIX', `Registry row ${i} (created_at ${row.createdAt}) does not match journal entry "${entry.tag}" (when ${entry.when}).`, {
            migration: entry.tag,
            details: { position: i, registryCreatedAt: row.createdAt, journalWhen: entry.when },
          }),
        );
      }
      continue;
    }
    const candidates = input.registryHashCandidates[entry.tag];
    if (candidates !== undefined && candidates.length > 0 && !candidates.includes(row.hash)) {
      out.push(
        diagnostic('HISTORY_HASH_MISMATCH', `The recorded hash of "${entry.tag}" differs from the hash of its SQL file: the file changed after it was applied.`, {
          migration: entry.tag,
          details: { position: i, registryHash: row.hash },
        }),
      );
    }
  }

  const maxApplied = rows.reduce((max, row) => (Number.isSafeInteger(row.createdAt) ? Math.max(max, row.createdAt) : max), 0);
  const pending = journal.slice(Math.min(rows.length, journal.length));
  for (const entry of pending) {
    if (entry.when <= maxApplied) {
      out.push(
        diagnostic(
          'PENDING_WHEN_AT_OR_BELOW_MAX_APPLIED',
          `Pending migration "${entry.tag}" has when ${entry.when}, not above the highest applied created_at ${maxApplied}; Drizzle would skip it silently.`,
          { migration: entry.tag, details: { when: entry.when, maxApplied } },
        ),
      );
    }
  }

  if (out.length > 0) {
    return { state: 'INCONSISTENT', appliedCount: 0, pending: [], diagnostics: out };
  }
  return { state: 'CONSISTENT', appliedCount: rows.length, pending, diagnostics: [] };
}
