// Tests of the secret scanner (B4.11.5.7). Every secret here is FICTITIOUS and built at run time (random, in memory or in a throw-away temporary repository);
// no historical credential and no real value appears in this file, which is itself scanned by the repository scan.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from './cli.mjs';
import { isPlaceholder, judgeLiteral, scanRepository, scanText } from './scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'cli.mjs');
const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A random fictitious credential with four character classes (recognised as "confirmed"). The random part is returned separately to check for fragments. */
function fakeSecret() {
  const random = randomBytes(9).toString('hex');
  return { value: `Aa1!${random}`, random };
}
const KEY = ['pass', 'word'].join('');
const assignment = (value, name = `admin${KEY[0].toUpperCase()}${KEY.slice(1)}`) => `export const ${name} = "${value}";\n`;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotepath=off', '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function newRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  temps.push(dir);
  git(dir, 'init', '-q');
  return dir;
}
function put(dir, rel, content) {
  const full = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const stage = (dir, ...rels) => git(dir, 'add', '--', ...rels);

/** Runs the real CLI in-process, capturing everything it prints. */
function cli(args) {
  const lines = [];
  const code = run(args, (l) => lines.push(l), (l) => lines.push(l));
  return { code, text: lines.join('\n') };
}
const snapshotIndex = (dir) => `${git(dir, 'ls-files', '-s')}\n${git(dir, 'diff', '--cached', '--raw')}`;

describe('detection', () => {
  it('1. detects a literal password assigned to a variable (and reports file, line, rule, severity)', () => {
    const dir = newRepo();
    put(dir, 'src/app.ts', `// header\n${assignment(fakeSecret().value)}`);
    const r = scanRepository({ root: dir, mode: 'working-tree' });
    assert.equal(r.findings.length, 1);
    assert.deepEqual({ path: r.findings[0].path, line: r.findings[0].line, rule: r.findings[0].rule, confidence: r.findings[0].confidence, severity: r.findings[0].severity }, { path: 'src/app.ts', line: 2, rule: 'secret-assignment', confidence: 'confirmed', severity: 'high' });
  });

  it('2. detects realistic credential shapes: provider token, JWT, private-key header, URL credentials, bearer token', () => {
    const dir = newRepo();
    const body = randomBytes(30).toString('hex');
    const lines = [
      `const a = "${'gh'}${'p_'}${body.slice(0, 36)}";`,
      `const b = "${'ey'}${'J'}${body.slice(0, 20)}.${'ey'}${'J'}${body.slice(20, 40)}.${body.slice(40, 58)}";`,
      `// ${'-----BEGIN'} ${'RSA'} ${'PRIVATE'} ${'KEY-----'}`,
      `const c = "postgresql://svc:${fakeSecret().value}@db.internal:5432/x";`,
      `headers.authorization = "${'Bear'}${'er'} ${body.slice(0, 32)}";`,
    ].join('\n');
    put(dir, 'src/shapes.ts', lines);
    const rules = scanRepository({ root: dir, mode: 'working-tree' }).findings.map((f) => f.rule).sort();
    assert.deepEqual(rules, ['bearer-token', 'github-token', 'jwt', 'private-key', 'url-credentials']);
  });

  it('3. an environment variable without a value is not a finding', () => {
    const dir = newRepo();
    put(dir, '.env.example', `DB_${KEY.toUpperCase()}=\nJWT_SECRET=\nS3_SECRET_KEY=\nN8N_EVENTS_AUTH_TOKEN=\n`);
    assert.equal(scanRepository({ root: dir, mode: 'working-tree' }).findings.length, 0);
  });

  it('4. placeholders and markers are not findings', () => {
    const dir = newRepo();
    const lines = [
      `DB_${KEY.toUpperCase()}=CHANGE_ME_before_use`,
      `${KEY}: "<your-${KEY}-here>"`,
      `const token = '\${process.env.TOKEN_VALUE}';`,
      `api_key = "REPLACE_ME_with_the_real_one"`,
      `const secret = "xxxxxxxxxxxxxxxx";`,
      `MIGRATOR_URL=postgresql://postgres:${KEY}@127.0.0.1:5432/db`,
      `x-token: not-a-secret-just-a-fixture`,
    ].join('\n');
    put(dir, 'docs/setup.md', lines);
    put(dir, 'src/ok.ts', `export const passwordLabel = 'Contraseña actual';\nconst tokenKey = 'refresh_token_cookie';\n`);
    assert.deepEqual(scanRepository({ root: dir, mode: 'working-tree' }).findings, []);
  });

  it('5. names without an assignment are not findings (types, parameters, comparisons, identifiers)', () => {
    const dir = newRepo();
    put(
      dir,
      'src/names.ts',
      [`type Token = string;`, `function checkPassword(password: string, secret: Buffer): boolean { return password === secret.toString(); }`, `const hasPassword = user.passwordHash !== null;`, `export const PASSWORD_MIN_LENGTH = 12;`, `const token = await issueToken(user);`].join('\n'),
    );
    assert.deepEqual(scanRepository({ root: dir, mode: 'working-tree' }).findings, []);
  });

  it('documentation prose that pastes a login pair ("Login: `user` / `value`") is detected, a placeholder pair is not', () => {
    const dir = newRepo();
    put(dir, 'docs/spec.md', `Login: \`qa@example.test\` / \`${fakeSecret().value}\` (admin)\n`);
    assert.deepEqual(scanRepository({ root: dir, mode: 'working-tree' }).findings.map((f) => f.rule), ['login-pair']);
    put(dir, 'docs/spec.md', 'Login: `<QA_ADMIN_EMAIL>` / `<QA_ADMIN_PASSWORD>` (admin)\n');
    assert.deepEqual(scanRepository({ root: dir, mode: 'working-tree' }).findings, []);
  });

  it('judgeLiteral / isPlaceholder: classes, identifiers, env-var names and prose', () => {
    assert.equal(judgeLiteral(fakeSecret().value), 'confirmed');
    assert.equal(judgeLiteral('N8N_EVENTS_AUTH_TOKEN'), null);
    assert.equal(judgeLiteral('platform_refresh_token'), null);
    assert.equal(judgeLiteral('short1!'), null);
    assert.equal(judgeLiteral('a sentence with spaces in it 1!'), null);
    assert.equal(isPlaceholder('${SOMETHING}'), true);
    assert.equal(isPlaceholder(fakeSecret().value), false);
  });

  it('test files only produce suspects for assignments, but real key material stays confirmed', () => {
    const secret = fakeSecret().value;
    const asTest = scanText('apps/x/src/thing.spec.ts', assignment(secret));
    assert.deepEqual(asTest.findings.map((f) => [f.rule, f.confidence]), [['secret-assignment', 'suspect']]);
    const key = scanText('apps/x/src/thing.spec.ts', `// ${'-----BEGIN'} ${'PRIVATE'} ${'KEY-----'}`);
    assert.deepEqual(key.findings.map((f) => [f.rule, f.confidence]), [['private-key', 'confirmed']]);
  });
});

describe('output and exit codes', () => {
  it('6. never prints the value, nor any fragment of it, in the report, the error path or the findings objects', () => {
    const dir = newRepo();
    const s = fakeSecret();
    put(dir, 'src/leak.ts', assignment(s.value));
    const out = cli(['--mode', 'working-tree', '--root', dir]);
    assert.equal(out.code, 1);
    assert.ok(out.text.includes('src/leak.ts:1'));
    assert.ok(!out.text.includes(s.value) && !out.text.includes(s.random) && !out.text.includes(s.random.slice(0, 6)));
    const structured = JSON.stringify(scanRepository({ root: dir, mode: 'working-tree' }));
    assert.ok(!structured.includes(s.random.slice(0, 6)));
    const real = spawnSync(process.execPath, [CLI, '--mode', 'working-tree', '--root', dir], { encoding: 'utf8' });
    assert.ok(!`${real.stdout}${real.stderr}`.includes(s.random.slice(0, 6)));
    // a configuration error must not echo content either
    put(dir, '.secret-scan-allow.json', '{ "version": 1, "entries": [ { "path": "a", "rule": "b", "reason": "a reason that is long enough", "reviewedIn": "x", "value": "' + s.value + '" } ] }');
    const bad = cli(['--mode', 'working-tree', '--root', dir]);
    assert.equal(bad.code, 2);
    assert.ok(!bad.text.includes(s.random.slice(0, 6)));
  });

  it('7. exit code: 0 clean, 1 confirmed, 2 usage error (real process)', () => {
    const dir = newRepo();
    put(dir, 'src/ok.ts', 'export const a = 1;\n');
    const spawn = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }).status;
    assert.equal(spawn('--mode', 'working-tree', '--root', dir), 0);
    put(dir, 'src/bad.ts', assignment(fakeSecret().value));
    assert.equal(spawn('--mode', 'working-tree', '--root', dir), 1);
    assert.equal(spawn('--mode', 'nonsense', '--root', dir), 2);
    assert.equal(spawn('--bogus'), 2);
  });

  it('suspects alone exit 0, and 1 with --strict', () => {
    const dir = newRepo();
    put(dir, 'src/a.ts', assignment('lowercase99x'));
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 0);
    assert.equal(cli(['--mode', 'working-tree', '--root', dir, '--strict']).code, 1);
  });
});

describe('exceptions', () => {
  it('8. a reasoned allowlist entry and a reasoned inline marker are honoured; unreasoned ones are not; a stale entry is an error', () => {
    const dir = newRepo();
    put(dir, 'src/a.ts', assignment(fakeSecret().value));
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 1);
    put(dir, '.secret-scan-allow.json', JSON.stringify({ version: 1, entries: [{ path: 'src/a.ts', rule: 'secret-assignment', reason: 'Fictitious fixture used only by a unit test, verified by hand.', reviewedIn: 'test' }] }));
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 0);
    // stale: the entry no longer matches anything
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    const stale = cli(['--mode', 'working-tree', '--root', dir]);
    assert.equal(stale.code, 2);
    assert.match(stale.text, /stale-allowlist-entry/);
    // inline marker
    rmSync(path.join(dir, '.secret-scan-allow.json'));
    put(dir, 'src/a.ts', `// secret-scan:allow fictitious value used by a unit test only\n${assignment(fakeSecret().value)}`);
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 0);
    put(dir, 'src/a.ts', `// secret-scan:allow ok\n${assignment(fakeSecret().value)}`);
    const weak = cli(['--mode', 'working-tree', '--root', dir]);
    assert.equal(weak.code, 1);
    assert.match(weak.text, /allow-marker-without-reason/);
  });

  it('allowlist validation: a reason is mandatory and no field can hold a value', () => {
    const dir = newRepo();
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    for (const entry of [{ path: 'a', rule: 'r', reviewedIn: 'x' }, { path: 'a', rule: 'r', reason: 'too short', reviewedIn: 'x' }, { path: 'a', rule: 'r', reason: 'a long enough reason here', reviewedIn: 'x', value: 'nope' }]) {
      put(dir, '.secret-scan-allow.json', JSON.stringify({ version: 1, entries: [entry] }));
      assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 2);
    }
  });
});

describe('exclusions', () => {
  it('9. excluded paths are never opened; sensitive file NAMES are findings without opening them', () => {
    const dir = newRepo();
    const secret = fakeSecret().value;
    put(dir, 'node_modules/pkg/index.js', assignment(secret));
    put(dir, 'scratchpad/notes.txt', assignment(secret));
    put(dir, 'dist/bundle.js', assignment(secret));
    put(dir, '.dev-pgdata/leftover.conf', assignment(secret));
    put(dir, 'Backups/old/config.ts', assignment(secret));
    put(dir, '.env.local', `X_${KEY.toUpperCase()}=${secret}\n`);
    put(dir, 'fq/su.pw', `${secret}\n`);
    put(dir, 'src/ok.ts', 'export const a = 1;\n');
    const opened = [];
    const r = scanRepository({ root: dir, mode: 'working-tree', onRead: (p) => opened.push(p) });
    assert.deepEqual(opened, ['src/ok.ts']);
    assert.deepEqual(r.findings.map((f) => [f.path, f.rule]).sort(), [['.env.local', 'sensitive-file-env'], ['fq/su.pw', 'sensitive-file-password']]);
    assert.ok(!JSON.stringify(r).includes(secret.slice(4, 10)));
    // .env.example is the documented exception and IS scanned
    put(dir, '.env.example', `JWT_SECRET=\n`);
    const again = [];
    scanRepository({ root: dir, mode: 'working-tree', onRead: (p) => again.push(p) });
    assert.ok(again.includes('.env.example'));
  });

  it('binary files and oversized files are skipped, not failed', () => {
    const dir = newRepo();
    const secret = fakeSecret().value;
    put(dir, 'assets/blob.dat', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(assignment(secret))]));
    put(dir, 'assets/logo.png', assignment(secret));
    put(dir, 'big.txt', 'x'.repeat(1_200_000));
    const r = scanRepository({ root: dir, mode: 'working-tree' });
    assert.equal(r.findings.length, 0);
    assert.ok(r.totals.skipped.binary >= 1 && r.totals.skipped['binary-extension'] >= 1 && r.totals.skipped['too-large'] >= 1);
  });
});

describe('staged mode', () => {
  it('10/11. reads the INDEX: a secret staged but fixed in the working tree is found; a clean staged blob is clean even if the working file has a secret', () => {
    const dir = newRepo();
    const secret = fakeSecret().value;
    put(dir, 'src/a.ts', assignment(secret));
    stage(dir, 'src/a.ts');
    put(dir, 'src/a.ts', 'export const a = 1;\n'); // working tree is now clean, the index is not
    const staged = cli(['--mode', 'staged', '--root', dir]);
    assert.equal(staged.code, 1);
    assert.match(staged.text, /src\/a\.ts:1/);
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 0);

    const dir2 = newRepo();
    put(dir2, 'src/b.ts', 'export const b = 1;\n');
    stage(dir2, 'src/b.ts');
    put(dir2, 'src/b.ts', assignment(fakeSecret().value)); // unstaged edit with a secret
    assert.equal(cli(['--mode', 'staged', '--root', dir2]).code, 0);
    assert.equal(cli(['--mode', 'working-tree', '--root', dir2]).code, 1);
  });

  it('12. does not alter the index or the working files', () => {
    const dir = newRepo();
    put(dir, 'src/a.ts', assignment(fakeSecret().value));
    put(dir, 'src/ok.ts', 'export const a = 1;\n');
    stage(dir, 'src/a.ts');
    const before = snapshotIndex(dir);
    const worktree = readFileSync(path.join(dir, 'src', 'a.ts'), 'utf8');
    cli(['--mode', 'staged', '--root', dir]);
    assert.equal(snapshotIndex(dir), before);
    assert.equal(readFileSync(path.join(dir, 'src', 'a.ts'), 'utf8'), worktree);
    assert.match(git(dir, 'status', '--short'), /\?\? src\/ok\.ts/); // still untracked: nothing was added
  });

  it('13. paths with spaces and non-ASCII characters', () => {
    const dir = newRepo();
    put(dir, 'docs/mi carpeta/contraseña é ñ.md', `Configuración:\n${assignment(fakeSecret().value)}`);
    stage(dir, 'docs/mi carpeta/contraseña é ñ.md');
    const staged = cli(['--mode', 'staged', '--root', dir]);
    assert.equal(staged.code, 1);
    assert.ok(staged.text.includes('docs/mi carpeta/contraseña é ñ.md:2'));
    assert.equal(cli(['--mode', 'working-tree', '--root', dir]).code, 1);
  });

  it('14. deleted, renamed and binary entries do not make it fail or crash', () => {
    const dir = newRepo();
    put(dir, 'src/gone.ts', 'export const a = 1;\n');
    put(dir, 'src/old.ts', 'export const b = 2;\n');
    put(dir, 'img/pic.bin', Buffer.from([0, 255, 0, 17]));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    git(dir, 'rm', '-q', 'src/gone.ts');
    git(dir, 'mv', 'src/old.ts', 'src/new name.ts');
    put(dir, 'img/pic2.bin', Buffer.concat([Buffer.from([0, 0]), Buffer.from(assignment(fakeSecret().value))]));
    stage(dir, 'img/pic2.bin');
    const r = cli(['--mode', 'staged', '--root', dir]);
    assert.equal(r.code, 0, r.text);
    // a deletion-only change set
    const dir2 = newRepo();
    put(dir2, 'a.ts', 'export const a = 1;\n');
    git(dir2, 'add', '-A');
    git(dir2, 'commit', '-q', '-m', 'base');
    git(dir2, 'rm', '-q', 'a.ts');
    assert.equal(cli(['--mode', 'staged', '--root', dir2]).code, 0);
    // nothing staged at all
    assert.equal(cli(['--mode', 'staged', '--root', newRepo()]).code, 0);
  });
});

describe('range mode (CI)', () => {
  it('sees a secret added by an EARLY commit even when a later commit removed it, with the right line, and ignores removed lines', () => {
    const dir = newRepo();
    put(dir, 'src/a.ts', 'line1\nline2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    put(dir, 'src/a.ts', `line1\nline2\n${assignment(fakeSecret().value)}`);
    git(dir, 'commit', '-q', '-am', 'adds');
    put(dir, 'src/a.ts', 'line1\nline2\n');
    git(dir, 'commit', '-q', '-am', 'removes');
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const r = cli(['--mode', 'range', '--root', dir, '--from', base, '--to', head]);
    assert.equal(r.code, 1);
    assert.match(r.text, /src\/a\.ts:3/);
    // the range that only contains the removal is clean
    const mid = git(dir, 'rev-parse', 'HEAD~1').trim();
    assert.equal(cli(['--mode', 'range', '--root', dir, '--from', mid, '--to', head]).code, 0);
  });

  it('a committed .env is a finding by name; its content is never requested', () => {
    const dir = newRepo();
    put(dir, 'a.txt', 'a\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    const secret = fakeSecret();
    put(dir, '.env', `X_${KEY.toUpperCase()}=${secret.value}\n`);
    git(dir, 'add', '-f', '.env');
    git(dir, 'commit', '-q', '-m', 'oops');
    const r = cli(['--mode', 'range', '--root', dir, '--from', base, '--to', 'HEAD']);
    assert.equal(r.code, 1);
    assert.match(r.text, /sensitive-file-env\s+\.env/);
    assert.ok(!r.text.includes(secret.random.slice(0, 6)));
  });
});

describe('the pre-commit hook (real git commit in a throw-away repository)', () => {
  it('rejects a commit that stages a secret, accepts a clean one, and leaves the index as it was', () => {
    const dir = newRepo();
    mkdirSync(path.join(dir, 'tools', 'secret-scan'), { recursive: true });
    for (const f of ['scan.mjs', 'cli.mjs']) cpSync(path.join(HERE, f), path.join(dir, 'tools', 'secret-scan', f));
    mkdirSync(path.join(dir, '.githooks'));
    cpSync(path.join(HERE, '..', '..', '.githooks', 'pre-commit'), path.join(dir, '.githooks', 'pre-commit'));
    git(dir, 'config', 'core.hooksPath', '.githooks');
    git(dir, 'update-index', '--chmod=+x', '--add', '.githooks/pre-commit');
    const secret = fakeSecret();
    put(dir, 'src/a.ts', assignment(secret.value));
    stage(dir, 'src/a.ts');
    const before = snapshotIndex(dir);
    const rejected = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'x'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stdout}${rejected.stderr}`, /src\/a\.ts:1/);
    assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(secret.random.slice(0, 6)));
    assert.equal(snapshotIndex(dir), before);
    assert.throws(() => git(dir, 'rev-parse', '--verify', 'HEAD'), /./); // no commit was made
    // fix it and commit
    put(dir, 'src/a.ts', 'export const a = 1;\n');
    stage(dir, 'src/a.ts');
    const accepted = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'ok'], { cwd: dir, encoding: 'utf8' });
    assert.equal(accepted.status, 0, `${accepted.stdout}${accepted.stderr}`);
  });
});
