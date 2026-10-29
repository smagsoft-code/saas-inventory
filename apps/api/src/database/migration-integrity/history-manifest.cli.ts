import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HISTORY_MANIFEST_FILE, buildHistoryManifest, validateAgainstHistoryManifest, validateClassifications } from './history-manifest';
import { parseDecisionArgs, planManifestAppend } from './manifest-update';
import { validateJournal } from './journal-validator';
import { findUndeclaredPrivileged, privilegedTags, validatePrivilegedManifest } from './privileged-manifest';
import { DEFAULT_MIGRATIONS_DIR, readMigrationsFolder } from './migration-files';
import { formatDiagnostics } from './execution-guard';

/**
 * Checks, or extends, `database/migrations/history-manifest.json`. No database involved.
 *
 *   pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/history-manifest.cli.ts            # check (default)
 *   pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/history-manifest.cli.ts --write \
 *       --classify <tag>=ordinary|privileged [--classify ...] --reviewed-in <commit:sha | pr:n | review:id:YYYY-MM-DD>
 *   ... [--dir <migrations folder>]   (default: ../../database/migrations, relative to apps/api)
 *
 * `--check` (exit 1 on any finding) validates the journal, the history manifest (hashes AND the
 * explicit classification/review of every entry), the privileged manifest and the
 * undeclared-privileged-statement safety net against the real files.
 *
 * `--write` ONLY APPENDS entries for migrations the manifest does not list yet, each with the
 * classification and review reference the author passes (never a default: recording a hash is not
 * approving a migration). Everything is planned and validated first (`planManifestAppend`); on ANY
 * refusal nothing is written (exit 1). The privileged manifest is hand-edited and never written here.
 */

function main(argv: readonly string[]): number {
  const write = argv.includes('--write');
  const dirIndex = argv.indexOf('--dir');
  const dir = dirIndex >= 0 ? (argv[dirIndex + 1] ?? DEFAULT_MIGRATIONS_DIR) : DEFAULT_MIGRATIONS_DIR;

  const folder = readMigrationsFolder(dir);
  const problems = [...folder.diagnostics, ...validateJournal(folder.journal, folder.fileHashes)];
  if (problems.length > 0 || folder.historyManifest === null || folder.privilegedManifest === null) {
    console.error(`Cannot continue:\n${formatDiagnostics(problems)}`);
    return 1;
  }

  if (write) {
    const args = parseDecisionArgs(argv);
    if (args.problems.length > 0) {
      console.error(`Refusing to write; nothing was changed.\n${args.problems.join('\n')}`);
      return 1;
    }
    const plan = planManifestAppend({
      historyManifest: folder.historyManifest,
      privilegedManifest: folder.privilegedManifest,
      journal: folder.journal,
      fileHashes: folder.fileHashes,
      sqlByTag: folder.sqlByTag,
      decisions: args.decisions,
    });
    if (plan.refusals.length > 0) {
      console.error(`Refusing to write; nothing was changed.\n${formatDiagnostics(plan.refusals)}`);
      return 1;
    }
    if (plan.added.length === 0) {
      console.log('History manifest already lists every migration; nothing to write.');
    } else {
      writeFileSync(join(dir, HISTORY_MANIFEST_FILE), `${JSON.stringify(plan.manifest, null, 2)}\n`);
      console.log(`Appended ${plan.added.length} migration(s) to ${HISTORY_MANIFEST_FILE}: ${plan.added.join(', ')}`);
      console.log('Recording a hash and a classification does not approve the migration: review the diff and the SQL.');
    }
  }

  const reread = write ? readMigrationsFolder(dir) : folder;
  const privileged = reread.privilegedManifest ?? { manifestVersion: 1 as const, entries: [] };
  const history = reread.historyManifest ?? buildHistoryManifest([], {}, {});
  const findings = [
    ...validateAgainstHistoryManifest(reread.journal, reread.fileHashes, history),
    ...validateClassifications(history, privilegedTags(privileged)),
    ...validatePrivilegedManifest(privileged, reread.journal, reread.fileHashes),
    ...findUndeclaredPrivileged(privileged, reread.journal, reread.sqlByTag),
  ];
  if (findings.length > 0) {
    console.error(`Migration references are not consistent:\n${formatDiagnostics(findings)}`);
    return 1;
  }
  console.log(`OK: ${reread.journal.length} migrations; journal, history manifest (with classification and review) and privileged manifest are consistent with the files.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
