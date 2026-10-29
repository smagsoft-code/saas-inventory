import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMigrationsFolder } from '../migration-files';
import { applyExceptions } from './exceptions';
import { SQL_LINT_EXCEPTIONS_FILE, parseLintExceptions } from './exceptions-file';
import { lintMigrations } from './lint-folder';
import { loadSqlParser } from './sql-parser';

/**
 * `database/migrations/sql-lint-exceptions.json` as shipped, and how the folder reader treats it when it is absent or broken
 * (ADR-0041, D-8D.1). Reads the real folder; the absent / invalid cases work on a temporary COPY.
 */

const REAL = join(__dirname, '..', '..', '..', '..', '..', '..', 'database', 'migrations');
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function copyOfReal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saas-exc-'));
  scratch.push(dir);
  cpSync(REAL, dir, { recursive: true });
  return dir;
}

describe('the file the repository ships', () => {
  it('exists, is valid and is EMPTY: no exception was created for the 51 historical migrations', () => {
    const text = readFileSync(join(REAL, SQL_LINT_EXCEPTIONS_FILE), 'utf8');
    expect(parseLintExceptions(text)).toEqual({ exceptions: [], problems: [] });
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, exceptions: [] });
  });

  it('the folder reader sees it as present, with no exception and no diagnostic', () => {
    const folder = readMigrationsFolder(REAL);
    expect(folder.lintExceptionsFile).toBe('present');
    expect(folder.lintExceptions).toEqual([]);
    expect(folder.diagnostics).toEqual([]);
  });

  it('applying it to the real findings accepts nothing', async () => {
    const folder = readMigrationsFolder(REAL);
    const findings = lintMigrations(await loadSqlParser(), folder.journal, folder.sqlByTag, folder.historyManifest);
    const result = applyExceptions(findings, folder.lintExceptions, folder.fileHashes);
    expect(result.problems).toEqual([]);
    expect(result.findings.some((f) => f.accepted !== undefined)).toBe(false);
    expect(result.findings).toHaveLength(findings.length);
  });
});

describe('when the file is absent or broken', () => {
  let absent: ReturnType<typeof readMigrationsFolder>;
  beforeAll(() => {
    const dir = copyOfReal();
    rmSync(join(dir, SQL_LINT_EXCEPTIONS_FILE));
    absent = readMigrationsFolder(dir);
  });

  it('absent = no exceptions, by definition (exceptions only relax the linter, so losing the file can only make it stricter), and it says so', () => {
    expect(absent.lintExceptionsFile).toBe('absent');
    expect(absent.lintExceptions).toEqual([]);
    expect(absent.diagnostics).toEqual([]);
  });

  it.each([
    ['malformed JSON', '{ "schemaVersion": 1, "exceptions": [ '],
    ['an unknown schema version', '{ "schemaVersion": 9, "exceptions": [] }'],
    ['a wildcard exception', JSON.stringify({ schemaVersion: 1, exceptions: [{ ruleId: '*', tag: '0000_extensions_and_roles', sha256: 'a'.repeat(64), line: 1, reason: 'x'.repeat(40), reviewedIn: 'pr:1' }] })],
    ['an unknown field', JSON.stringify({ schemaVersion: 1, exceptions: [], extra: true })],
  ])('present but invalid (%s) → a diagnostic that stops the run before it connects, and nothing is taken from the file', (_name, text) => {
    const dir = copyOfReal();
    writeFileSync(join(dir, SQL_LINT_EXCEPTIONS_FILE), text);
    const folder = readMigrationsFolder(dir);
    expect(folder.lintExceptionsFile).toBe('present');
    expect(folder.lintExceptions).toEqual([]);
    expect(folder.diagnostics.map((d) => d.code)).toContain('LINT_EXCEPTION_INVALID');
  });
});
