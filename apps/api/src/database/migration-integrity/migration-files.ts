import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalMigrationHash, registryHashCandidates } from './hash';
import { HISTORY_MANIFEST_FILE, parseHistoryManifest, type HistoryManifest } from './history-manifest';
import { parseJournal } from './journal-validator';
import { PRIVILEGED_MANIFEST_FILE, parsePrivilegedManifest, type PrivilegedManifest } from './privileged-manifest';
import type { LintException } from './sql-lint/exceptions';
import { SQL_LINT_EXCEPTIONS_FILE, parseLintExceptions } from './sql-lint/exceptions-file';
import { diagnostic, type Diagnostic, type FileHashes, type JournalEntry, type RegistryHashCandidates } from './types';

/**
 * The only module of `migration-integrity/` that touches the file system, and only to READ the
 * migrations folder (`database/migrations/`): the journal, each `.sql` file and the two manifests.
 * No database, no writes.
 */

export interface MigrationsFolder {
  readonly dir: string;
  readonly journal: readonly JournalEntry[];
  /** Canonical (LF-normalised) hash per tag — the value the manifests hold. */
  readonly fileHashes: FileHashes;
  readonly registryHashCandidates: RegistryHashCandidates;
  readonly sqlByTag: Readonly<Record<string, string | undefined>>;
  readonly historyManifest: HistoryManifest | null;
  readonly privilegedManifest: PrivilegedManifest | null;
  /** The accepted lint findings of `sql-lint-exceptions.json`; empty when the file is absent (defined: exceptions only relax the linter). Invalid → `diagnostics`. */
  readonly lintExceptions: readonly LintException[];
  readonly lintExceptionsFile: 'present' | 'absent';
  /** Problems reading or parsing the references themselves (not the consistency checks). */
  readonly diagnostics: readonly Diagnostic[];
}

/** `database/migrations/` as seen from `apps/api` (the working directory `migrate.ts` runs in). */
export const DEFAULT_MIGRATIONS_DIR = '../../database/migrations';

export function readMigrationsFolder(dir: string = DEFAULT_MIGRATIONS_DIR): MigrationsFolder {
  const diagnostics: Diagnostic[] = [];

  const journalPath = join(dir, 'meta', '_journal.json');
  const parsed = existsSync(journalPath)
    ? parseJournal(readFileSync(journalPath).toString())
    : {
        entries: [] as JournalEntry[],
        diagnostics: [diagnostic('JOURNAL_MALFORMED', `The journal ${journalPath} does not exist.`)],
      };
  diagnostics.push(...parsed.diagnostics);

  const fileHashes: Record<string, string | null> = {};
  const candidates: Record<string, string[]> = {};
  const sqlByTag: Record<string, string | undefined> = {};
  for (const entry of parsed.entries) {
    const file = join(dir, `${entry.tag}.sql`);
    if (existsSync(file)) {
      const text = readFileSync(file).toString();
      sqlByTag[entry.tag] = text;
      fileHashes[entry.tag] = canonicalMigrationHash(text);
      candidates[entry.tag] = registryHashCandidates(text);
    } else {
      fileHashes[entry.tag] = null;
    }
  }

  const historyManifest = readManifest(join(dir, HISTORY_MANIFEST_FILE), parseHistoryManifest, diagnostics);
  const privilegedManifest = readManifest(join(dir, PRIVILEGED_MANIFEST_FILE), parsePrivilegedManifest, diagnostics);

  // The lint exceptions: absent = none (defined); present but invalid = a diagnostic, which stops the run before it connects.
  const exceptionsPath = join(dir, SQL_LINT_EXCEPTIONS_FILE);
  let lintExceptions: readonly LintException[] = [];
  let lintExceptionsFile: 'present' | 'absent' = 'absent';
  if (existsSync(exceptionsPath)) {
    lintExceptionsFile = 'present';
    const result = parseLintExceptions(readFileSync(exceptionsPath).toString());
    diagnostics.push(...result.problems);
    lintExceptions = result.exceptions ?? [];
  }

  return { dir, journal: parsed.entries, fileHashes, registryHashCandidates: candidates, sqlByTag, historyManifest, privilegedManifest, lintExceptions, lintExceptionsFile, diagnostics };
}

function readManifest<T>(
  path: string,
  parse: (text: string) => { manifest: T | null; diagnostics: Diagnostic[] },
  diagnostics: Diagnostic[],
): T | null {
  if (!existsSync(path)) {
    diagnostics.push(...parse('').diagnostics.map((d) => ({ ...d, message: `${path} does not exist or is unreadable. ${d.message}` })));
    return null;
  }
  const result = parse(readFileSync(path).toString());
  diagnostics.push(...result.diagnostics);
  return result.manifest;
}
