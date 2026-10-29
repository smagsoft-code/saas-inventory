import { readFileSync } from 'node:fs';
import { DEFAULT_MIGRATIONS_DIR, readMigrationsFolder } from './migration-files';
import { PARSER_INFO, applyExceptions, countBySeverity, exitCodeFor, formatTable, lintMigration, lintMigrations, loadSqlParser, sortFindings, summary } from './sql-lint';
import { formatDiagnostics } from './execution-guard';
import type { MigrationContext } from './sql-lint';

/**
 * Diagnostic and gate CLI of the SQL/RLS linter (ADR-0041, D-8D). Reads files only; no database, nothing is modified.
 *
 *   pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/sql-lint.cli.ts [--dir <migrations folder>]
 *        [--file <one.sql> [--classification ordinary|privileged]] [--format table|json] [--strict] [--quiet-info] [--no-exceptions]
 *
 * Without `--file` it lints every migration of the journal, each in the context (ordinary / privileged) the history manifest
 * gives it, and applies the reviewed exceptions of <folder>/sql-lint-exceptions.json (an accepted finding stays in the report,
 * marked as accepted). `--no-exceptions` shows everything the linter sees, accepted or not. `--file` never applies exceptions.
 *
 * Exit code: 0 = no ERROR (and, with --strict, no WARNING); 1 = at least one ERROR (or a WARNING with --strict);
 *            2 = unusable input (unknown option, unreadable file or folder, missing manifest, an invalid exceptions file or an
 *                exception that matches no finding).
 */

function main(argv: readonly string[]): Promise<number> {
  return run(argv).catch((error: unknown) => {
    console.error(`sql-lint failed (${error instanceof Error ? error.name : 'unknown error'}).`);
    return 2;
  });
}

async function run(argv: readonly string[]): Promise<number> {
  const known = new Set(['--dir', '--file', '--classification', '--format', '--strict', '--quiet-info', '--no-exceptions']);
  const valued = new Set(['--dir', '--file', '--classification', '--format']);
  const options = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!known.has(arg)) {
      console.error(`Unknown argument "${arg.startsWith('--') ? arg : '(positional)'}". ${usage()}`);
      return 2;
    }
    if (valued.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`${arg} needs a value. ${usage()}`);
        return 2;
      }
      options.set(arg, value);
      i += 1;
    } else {
      options.set(arg, true);
    }
  }
  const format = options.get('--format') ?? 'table';
  const classification = options.get('--classification') ?? 'ordinary';
  if ((format !== 'table' && format !== 'json') || (classification !== 'ordinary' && classification !== 'privileged')) {
    console.error(`Invalid --format or --classification. ${usage()}`);
    return 2;
  }
  const strict = options.get('--strict') === true;
  const parser = await loadSqlParser();

  let findings;
  if (typeof options.get('--file') === 'string') {
    const file = options.get('--file') as string;
    let sql: string;
    try {
      sql = readFileSync(file).toString();
    } catch {
      console.error('Cannot read the --file given.');
      return 2;
    }
    const tag = file.replace(/^.*[\\/]/, '').replace(/\.sql$/, '');
    findings = lintMigration(parser, sql, { tag, context: classification as MigrationContext });
  } else {
    const dir = typeof options.get('--dir') === 'string' ? (options.get('--dir') as string) : DEFAULT_MIGRATIONS_DIR;
    const folder = readMigrationsFolder(dir);
    if (folder.diagnostics.length > 0 || folder.journal.length === 0) {
      console.error(`Cannot read the migrations folder: ${folder.diagnostics.map((d) => d.code).join(', ') || 'empty journal'}.`);
      return 2;
    }
    findings = lintMigrations(parser, folder.journal, folder.sqlByTag, folder.historyManifest);
    if (options.get('--no-exceptions') !== true) {
      const result = applyExceptions(findings, folder.lintExceptions, folder.fileHashes);
      if (result.problems.length > 0) {
        console.error(`The exceptions file cannot be applied:
${formatDiagnostics(result.problems)}`);
        return 2;
      }
      findings = [...result.findings];
    }
  }

  const shown = options.get('--quiet-info') === true ? findings.filter((f) => f.severity !== 'INFO') : findings;
  if (format === 'json') {
    console.log(JSON.stringify({ parser: PARSER_INFO, counts: countBySeverity(findings), findings: sortFindings(shown) }, null, 2));
  } else {
    console.log(`SQL/RLS lint — parser ${PARSER_INFO.package}@${PARSER_INFO.version} (${PARSER_INFO.grammar}, ${PARSER_INFO.runtime})`);
    console.log(shown.length > 0 ? formatTable(shown) : '(no findings)');
    console.log(`\n${summary(findings)}`);
  }
  return exitCodeFor(findings, strict);
}

function usage(): string {
  return 'Usage: sql-lint.cli.ts [--dir <folder>] [--file <one.sql> [--classification ordinary|privileged]] [--format table|json] [--strict] [--quiet-info] [--no-exceptions]';
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
