import type { HistoryManifest } from '../history-manifest';
import type { JournalEntry } from '../types';
import { lintMigration, type LintFinding } from './lint-migration';
import type { MigrationContext } from './rules';
import type { SqlParser } from './sql-parser';

/**
 * Lints a set of migrations with the context the history manifest gives each one. A migration the manifest does not classify
 * (or whose classification is missing) is linted as `ordinary`, the stricter reading; the privileged manifest and the
 * classification are checked elsewhere (`validateClassifications`), this only reads them.
 */
export function contextOf(manifest: HistoryManifest | null, tag: string): MigrationContext {
  return manifest?.entries.find((e) => e.tag === tag)?.classification === 'privileged' ? 'privileged' : 'ordinary';
}

export function lintMigrations(
  parser: SqlParser,
  entries: readonly JournalEntry[],
  sqlByTag: Readonly<Record<string, string | undefined>>,
  manifest: HistoryManifest | null,
): LintFinding[] {
  const out: LintFinding[] = [];
  for (const entry of entries) {
    const sql = sqlByTag[entry.tag];
    if (sql === undefined) continue; // a missing file is the journal validator's finding
    out.push(...lintMigration(parser, sql, { tag: entry.tag, context: contextOf(manifest, entry.tag) }));
  }
  return out;
}
