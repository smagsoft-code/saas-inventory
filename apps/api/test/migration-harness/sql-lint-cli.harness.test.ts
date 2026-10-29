import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalMigrationHash } from '../../src/database/migration-integrity/hash';

/**
 * The real SQL/RLS linter CLI as a process (ADR-0041, D-8D): exit codes and output. Files only — no PostgreSQL is involved.
 *   0 = no ERROR (and no WARNING with --strict)   1 = an ERROR (or a WARNING with --strict)   2 = unusable input
 */

const API = join(__dirname, '..', '..');
const REAL = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saas-sqllint-'));
  scratch.push(dir);
  return dir;
}
function sqlFile(sql: string, name = '0099_probe.sql'): string {
  const path = join(temp(), name);
  writeFileSync(path, sql);
  return path;
}
function lint(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/database/migration-integrity/sql-lint.cli.ts', ...args], { cwd: API, encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('sql-lint.cli.ts exit codes', () => {
  it('no findings → 0', () => {
    const r = lint('--file', sqlFile('CREATE TABLE t (id int);'));
    expect(r.status).toBe(0);
    expect(r.out).toContain('(no findings)');
    expect(r.out).toContain('0 error(s), 0 warning(s), 0 info');
  });

  it('a WARNING only → 0, and 1 with --strict', () => {
    const file = sqlFile('GRANT SELECT ON t TO app_tenant;');
    const normal = lint('--file', file);
    expect(normal.status).toBe(0);
    expect(normal.out).toContain('PRIV-GRANT');
    expect(normal.out).toContain('0 error(s), 1 warning(s)');
    expect(lint('--file', file, '--strict').status).toBe(1);
  });

  it('an ERROR → 1, with file, line, rule and severity in the table', () => {
    const r = lint('--file', sqlFile('SELECT 1;\n\nGRANT SELECT ON t TO PUBLIC;'));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/0099_probe:3\s+PRIV-GRANT-PUBLIC\s+ERROR\s+high/);
    expect(r.out).toContain('1 error(s)');
  });

  it('the same SQL is an ERROR as ordinary and only INFO as privileged', () => {
    const file = sqlFile('CREATE ROLE r;');
    expect(lint('--file', file).status).toBe(1);
    const privileged = lint('--file', file, '--classification', 'privileged');
    expect(privileged.status).toBe(0);
    expect(privileged.out).toContain('ROLE-DDL');
  });

  it('SQL that does not parse → 1 (never reported clean)', () => {
    const r = lint('--file', sqlFile('CREATE TABEL t ();'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('LINT-PARSE-ERROR');
  });

  it('an empty file → 0 with a LINT-EMPTY warning; --strict makes it 1', () => {
    const file = sqlFile('-- nothing here\n');
    const normal = lint('--file', file);
    expect(normal.status).toBe(0);
    expect(normal.out).toContain('LINT-EMPTY');
    expect(lint('--file', file, '--strict').status).toBe(1);
  });

  it('--format json is machine-readable and carries the parser identity and the counts', () => {
    const r = lint('--file', sqlFile('GRANT SELECT ON t TO PUBLIC;'), '--format', 'json');
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.out) as { parser: { package: string; version: string; grammar: string }; counts: Record<string, number>; findings: { ruleId: string; line: number }[] };
    expect(parsed.parser).toMatchObject({ package: 'libpg-query', version: '16.8.1', grammar: 'PostgreSQL 16' });
    expect(parsed.counts['ERROR']).toBe(1);
    expect(parsed.findings[0]).toMatchObject({ ruleId: 'PRIV-GRANT-PUBLIC', line: 1 });
  });

  it('the real migrations folder: 0 errors → exit 0 (diagnostic mode, no exceptions); --strict → 1 because of the warnings', () => {
    const r = lint('--quiet-info');
    expect(r.status).toBe(0);
    expect(r.out).toContain('0 error(s)');
    expect(r.out).not.toContain('LINT-PARSE-ERROR');
    expect(lint('--strict', '--quiet-info').status).toBe(1);
  });

  it('a folder with an ERROR added to one migration → 1, naming that file and line (the original is untouched: this is a copy)', () => {
    const dir = temp();
    cpSync(REAL, dir, { recursive: true });
    const target = join(dir, '0001_platform_tables.sql');
    const before = readFileSync(target, 'utf8');
    writeFileSync(target, `${before}\n--> statement-breakpoint\nGRANT SELECT ON platform_admins TO PUBLIC;`);
    const r = lint('--dir', dir, '--quiet-info');
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/0001_platform_tables:\d+\s+PRIV-GRANT-PUBLIC\s+ERROR/);
  });

  it.each([
    [['--bogus']],
    [['positional.sql']],
    [['--file']],
    [['--format', 'xml']],
    [['--classification', 'root', '--file', 'x.sql']],
    [['--file', join(tmpdir(), 'saas-sqllint-does-not-exist.sql')]],
    [['--dir', join(tmpdir(), 'saas-sqllint-no-such-folder')]],
  ])('unusable input %j → 2', (args) => {
    const r = lint(...args);
    expect(r.status).toBe(2);
  });
});

describe('sql-lint.cli.ts and the exceptions file', () => {
  /** A COPY of the real folder with one ERROR appended to 0001 (so its hash and line are new), plus the exception that accepts it. */
  function folderWithAcceptedError(over: Record<string, unknown> = {}, fileText?: string) {
    const dir = temp();
    cpSync(REAL, dir, { recursive: true });
    const target = join(dir, '0001_platform_tables.sql');
    const text = `${readFileSync(target, 'utf8')}
--> statement-breakpoint
GRANT SELECT ON platform_admins TO PUBLIC;`;
    writeFileSync(target, text);
    const found = JSON.parse(lint('--dir', dir, '--quiet-info', '--no-exceptions', '--format', 'json').out) as { findings: { ruleId: string; tag: string; line: number }[] };
    const finding = found.findings.find((f) => f.ruleId === 'PRIV-GRANT-PUBLIC');
    if (finding === undefined) throw new Error('the probe finding was not produced');
    const exception = {
      ruleId: 'PRIV-GRANT-PUBLIC',
      tag: finding.tag,
      sha256: canonicalMigrationHash(text),
      line: finding.line,
      reason: 'Reviewed in the harness: the probe grant is the subject of this test.',
      reviewedIn: 'review:harness:2026-10-29',
      ...over,
    };
    writeFileSync(join(dir, 'sql-lint-exceptions.json'), fileText ?? JSON.stringify({ schemaVersion: 1, exceptions: [exception] }));
    return dir;
  }

  it('an exact exception accepts the ERROR (exit 0), the finding stays in the report as accepted, and --no-exceptions shows it open (exit 1)', () => {
    const dir = folderWithAcceptedError();
    const accepted = lint('--dir', dir, '--quiet-info');
    expect(accepted.status).toBe(0);
    expect(accepted.out).toMatch(/0001_platform_tables:\d+\s+PRIV-GRANT-PUBLIC\s+ERROR\s+high\s+-\s+accepted/);
    expect(accepted.out).toContain('1 accepted by exception');
    const open = lint('--dir', dir, '--quiet-info', '--no-exceptions');
    expect(open.status).toBe(1);
    expect(open.out).toMatch(/PRIV-GRANT-PUBLIC\s+ERROR\s+high\s+-\s+open/);
  });

  it.each([
    ['a stale hash', { sha256: 'e'.repeat(64) }],
    ['a wrong line', { line: 9999 }],
    ['a wrong rule', { ruleId: 'PRIV-REVOKE' }],
    ['a rule that cannot be excepted', { ruleId: 'TXN-CONTROL' }],
  ])('%s → exit 2 (the exceptions cannot be applied), never a silent pass', (_name, over) => {
    const r = lint('--dir', folderWithAcceptedError(over), '--quiet-info');
    expect(r.status).toBe(2);
    expect(r.out).toContain('LINT_EXCEPTION_INVALID');
  });

  it('--no-exceptions ignores the MEANING of the file (an obsolete entry no longer fails the run) but never its structure (a malformed file is still exit 2)', () => {
    // a well-formed exception that matches no finding on the real, untouched folder
    const stale = { ruleId: 'PRIV-GRANT-PUBLIC', tag: '0001_platform_tables', sha256: 'a'.repeat(64), line: 1, reason: 'A stale entry that corresponds to no finding any more.', reviewedIn: 'pr:1' };
    const dir = temp();
    cpSync(REAL, dir, { recursive: true });
    writeFileSync(join(dir, 'sql-lint-exceptions.json'), JSON.stringify({ schemaVersion: 1, exceptions: [stale] }));
    expect(lint('--dir', dir, '--quiet-info').status).toBe(2); // normal run: the obsolete exception is an error
    const raw = lint('--dir', dir, '--quiet-info', '--no-exceptions');
    expect(raw.status).toBe(0); // the raw findings of the real folder: warnings only
    expect(raw.out).toContain('0 error(s)');
    writeFileSync(join(dir, 'sql-lint-exceptions.json'), '{ "schemaVersion": 1, ');
    expect(lint('--dir', dir, '--quiet-info', '--no-exceptions').status).toBe(2);
  });

  it('a malformed exceptions file → exit 2', () => {
    const r = lint('--dir', folderWithAcceptedError({}, '{ "schemaVersion": 1, '), '--quiet-info');
    expect(r.status).toBe(2);
    expect(r.out).toContain('LINT_EXCEPTION_INVALID');
  });
});
