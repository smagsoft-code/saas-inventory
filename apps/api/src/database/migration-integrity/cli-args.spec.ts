import { describe, expect, it } from 'vitest';
import { parseMigrateArgs } from './cli-args';
import { formatDiagnostics } from './execution-guard';

const ok = (argv: string[]) => parseMigrateArgs(argv).args;
const refused = (argv: string[]) => parseMigrateArgs(argv);

describe('parseMigrateArgs — accepted', () => {
  it.each([
    [[], { mode: undefined, provisionOnly: false }],
    [['--mode', 'bootstrap'], { mode: 'bootstrap', provisionOnly: false }],
    [['--mode=incremental'], { mode: 'incremental', provisionOnly: false }],
    [['--provision-only'], { mode: undefined, provisionOnly: true }],
    [['--mode', 'bootstrap', '--provision-only'], { mode: 'bootstrap', provisionOnly: true }],
    [['--provision-only', '--mode=bootstrap'], { mode: 'bootstrap', provisionOnly: true }],
  ])('%j', (argv, expected) => {
    expect(ok(argv)).toEqual(expected);
  });

  it('tolerates the single leading "--" that pnpm 9 forwards (pnpm run db:migrate -- --mode x)', () => {
    expect(ok(['--', '--mode', 'bootstrap'])).toEqual({ mode: 'bootstrap', provisionOnly: false });
    expect(ok(['--', '--provision-only'])).toEqual({ mode: undefined, provisionOnly: true });
    expect(ok(['--'])).toEqual({ mode: undefined, provisionOnly: false });
  });
});

describe('parseMigrateArgs — refused, so that nothing runs', () => {
  it.each([
    ['a mistyped flag (would otherwise run a full migration)', ['--provision-onyl']],
    ['an unknown flag', ['--force']],
    ['a typo of --mode', ['--mod', 'bootstrap']],
    ['a positional argument', ['bootstrap']],
    ['a second "--"', ['--', '--', '--mode', 'bootstrap']],
    ['--mode without a value', ['--mode']],
    ['--mode followed by a flag', ['--mode', '--provision-only']],
    ['--mode with an unknown value', ['--mode', 'superuser']],
    ['--mode= with an empty value', ['--mode=']],
    ['a repeated --mode', ['--mode', 'bootstrap', '--mode', 'incremental']],
    ['a repeated --provision-only', ['--provision-only', '--provision-only']],
    ['--provision-only with incremental mode', ['--mode', 'incremental', '--provision-only']],
    ['--provision-only= with a value', ['--provision-only=true']],
  ])('%s', (_name, argv) => {
    const r = refused(argv);
    expect(r.args).toBeNull();
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics.every((d) => d.code === 'CLI_ARGUMENT_INVALID')).toBe(true);
  });

  it('never echoes an argument that is not shaped like a plain flag (it could be a connection string)', () => {
    const secret = 'postgresql://boot:very-secret@host/db';
    const text = formatDiagnostics(refused([secret, '--mode=pw-secret-value']).diagnostics);
    expect(text).not.toContain('very-secret');
    expect(text).not.toContain('pw-secret-value');
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('names an unknown plain flag so the author can fix the typo', () => {
    expect(formatDiagnostics(refused(['--provision-onyl']).diagnostics)).toContain('--provision-onyl');
  });
});
