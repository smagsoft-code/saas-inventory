import { buildHistoryManifest, type EntryDecision } from './history-manifest';
import { canonicalMigrationHash, hashMigrationSql, registryHashCandidates } from './hash';
import type { IdentityFacts } from './execution-guard';
import type { PrivilegedManifest } from './privileged-manifest';
import type { FileHashes, JournalEntry, RegistryHashCandidates, RegistryRow } from './types';

/**
 * Synthetic data for the unit specs of `migration-integrity/`. No real migration, no database.
 * Not imported by production code.
 */

export const TAG_0000 = '0000_extensions_and_roles';
export const TAG_0019 = '0019_import_worker_role';
const BASE_WHEN = 1_700_000_000_000;

export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`fixture: missing ${what}`);
  return value;
}

export function makeJournal(count: number): JournalEntry[] {
  return Array.from({ length: count }, (_, idx) => ({
    idx,
    version: '7',
    when: BASE_WHEN + idx * 1000,
    tag: idx === 0 ? TAG_0000 : idx === 19 ? TAG_0019 : `${String(idx).padStart(4, '0')}_m${idx}`,
    breakpoints: true,
  }));
}

export function sqlFor(tag: string): string {
  return `-- ${tag}\nSELECT 1;\n`;
}

export interface Files {
  readonly sqlByTag: Record<string, string>;
  readonly fileHashes: FileHashes;
  readonly registryHashCandidates: RegistryHashCandidates;
}

export function makeFiles(journal: readonly JournalEntry[], overrides: Readonly<Record<string, string>> = {}): Files {
  const sqlByTag: Record<string, string> = {};
  const fileHashes: Record<string, string> = {};
  const candidates: Record<string, string[]> = {};
  for (const entry of journal) {
    const text = overrides[entry.tag] ?? sqlFor(entry.tag);
    sqlByTag[entry.tag] = text;
    fileHashes[entry.tag] = canonicalMigrationHash(text);
    candidates[entry.tag] = registryHashCandidates(text);
  }
  return { sqlByTag, fileHashes, registryHashCandidates: candidates };
}

/** The registry rows Drizzle would have written after applying the first `applied` migrations. */
export function registryRows(journal: readonly JournalEntry[], applied: number, files: Files): RegistryRow[] {
  return journal.slice(0, applied).map((entry) => ({
    hash: hashMigrationSql(must(files.sqlByTag[entry.tag], entry.tag)),
    createdAt: entry.when,
  }));
}

export function privilegedManifestFor(files: Files): PrivilegedManifest {
  return {
    manifestVersion: 1,
    entries: [TAG_0000, TAG_0019].map((tag) => ({
      tag,
      sha256: must(files.fileHashes[tag], tag),
      reason: 'test',
    })),
  };
}

export const TEST_REVIEW = 'retroactive-review:test:2026-01-01';

/** The decisions a reviewer would have given: 0000 and 0019 privileged, everything else ordinary. */
export function decisionsFor(journal: readonly JournalEntry[]): Record<string, EntryDecision> {
  return Object.fromEntries(
    journal.map((entry) => [
      entry.tag,
      { classification: entry.tag === TAG_0000 || entry.tag === TAG_0019 ? 'privileged' : 'ordinary', reviewedIn: TEST_REVIEW } as EntryDecision,
    ]),
  );
}

export function historyManifestFor(journal: readonly JournalEntry[], files: Files) {
  return buildHistoryManifest(journal, files.fileHashes, decisionsFor(journal));
}

export function incrementalFacts(overrides: Partial<IdentityFacts> = {}): IdentityFacts {
  return {
    database: 'app',
    sessionUser: 'migrator_inc',
    currentUser: 'app_migrator',
    sessionIsSuperuser: false,
    sessionBypassRls: false,
    sessionCreateRole: false,
    currentIsSuperuser: false,
    currentBypassRls: false,
    appMigratorRoleExists: true,
    sessionHasSetMembership: true,
    appMigratorHasDatabaseCreate: true,
    ...overrides,
  };
}

export function bootstrapFacts(overrides: Partial<IdentityFacts> = {}): IdentityFacts {
  return incrementalFacts({
    sessionUser: 'postgres',
    currentUser: 'postgres',
    sessionIsSuperuser: true,
    sessionBypassRls: true,
    sessionCreateRole: true,
    currentIsSuperuser: true,
    currentBypassRls: true,
    appMigratorRoleExists: false,
    sessionHasSetMembership: false,
    appMigratorHasDatabaseCreate: false,
    ...overrides,
  });
}
