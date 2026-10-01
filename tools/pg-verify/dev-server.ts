/**
 * Local dev bring-up — NOT the CI verification harness (`verify-real-postgres.ts`, kept separate
 * and unmodified). Reuses this package's `embedded-postgres` dependency to start a REAL,
 * Docker-free local PostgreSQL matching the values already committed to the repo root `.env` (see
 * that file's own header comment — this is the "wrapper" it refers to), then brings up the dev S3
 * shim (`scratchpad/dev-s3-shim.mjs`), the API, and the Web dev servers as child processes, and
 * finally provisions one fresh admin login via the real `POST /api/v1/auth/register` endpoint so
 * there's something to log into immediately.
 *
 * Ctrl+C (SIGINT/SIGTERM) tears every child process down and wipes the ephemeral Postgres data
 * directory — nothing here is meant to persist, exactly like `.env`'s header says. That's the
 * ONLY sanctioned way this data disappears, though: it's a live, file-locked Postgres cluster
 * while running, not just "some scratch files."
 *
 * POSTMORTEM (in-session incident, no ticket — logged here since it cost a full QA dataset):
 * `git stash push -u` (and `git clean -fd`, and anything else that sweeps up "untracked" paths)
 * does NOT know or care that `scratchpad/.dev-pgdata/` is an active database's data directory —
 * it just deletes untracked files, mid-write, while Postgres has them open. Postgres crashed
 * instantly; every row created during that dev session was gone, and the working directory kept
 * running against a half-deleted data directory until it was manually torn down and rebuilt from
 * this script + `seed-qa-data.ts`. `scratchpad/` is now in the repo root `.gitignore` specifically
 * so `git stash -u` / `git clean` skip it by default (they only sweep untracked-but-NOT-ignored
 * paths) — never remove that `.gitignore` entry, and never run a git command that can delete
 * untracked files while this dev server (or any embedded-Postgres instance) is running. If you
 * need to isolate a subset of changes for a commit, use `git add -p` / a scratch worktree with the
 * files copied in, not a stash/clean against the live working directory.
 *
 * Usage: pnpm --filter @saas-inventory/pg-verify dev
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DATA_DIR = path.resolve(REPO_ROOT, 'scratchpad', '.dev-pgdata');
const S3_DATA_DIR = path.resolve(REPO_ROOT, 'scratchpad', 's3data');

const QA_ADMIN = {
  companyName: 'QA Dev Tenant',
  email: 'qa-admin@dev.local',
  password: 'DevPassword123!',
  fullName: 'QA Admin',
};

/** A minimal `.env` parser — `KEY=VALUE` lines, `#` comments, blank lines skipped. No quoting/
 * multiline support: this repo's own `.env` (checked at the top of this file's own header) never
 * needs either. */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

function section(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function runOrThrow(label: string, args: string[], env: NodeJS.ProcessEnv): void {
  console.log(`\n--- ${label} ---`);
  const result = spawnSync('pnpm', args, { cwd: REPO_ROOT, stdio: 'inherit', env, shell: true });
  if (result.status !== 0) {
    throw new Error(`"${label}" exited with status ${String(result.status)}`);
  }
}

const children: ChildProcess[] = [];
function spawnChild(label: string, command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  console.log(`\n--- starting ${label} ---`);
  const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env, shell: true });
  child.on('exit', (code, signal) => {
    console.log(`[dev-server] ${label} exited (code=${String(code)}, signal=${String(signal)})`);
  });
  children.push(child);
  return child;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // API not accepting connections yet — keep polling.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  return false;
}

async function registerQaAdmin(apiUrl: string): Promise<void> {
  section('Provisioning a fresh QA admin login (real POST /api/v1/auth/register)');
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(QA_ADMIN),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`  [WARN] register returned ${response.status}: ${body}`);
      console.log('  You can still register manually at http://localhost:3000/register');
      return;
    }
    console.log('  QA admin ready — log in at http://localhost:3000/login with:');
    console.log(`    email:    ${QA_ADMIN.email}`);
    console.log(`    password: ${QA_ADMIN.password}`);
  } catch (error) {
    console.log(`  [WARN] could not reach the API to register a QA admin: ${String(error)}`);
    console.log('  You can still register manually at http://localhost:3000/register');
  }
}

let shuttingDown = false;
let pg: EmbeddedPostgres | undefined;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  section('Shutting down (Ctrl+C) — stopping every child process and wiping the ephemeral DB');
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  if (pg) {
    await pg.stop().catch((error: unknown) => console.error('  postgres stop failed:', error));
  }
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(0);
}

async function main(): Promise<void> {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath} — copy .env.example to .env first.`);
  }
  const fileEnv = parseEnvFile(envPath);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };

  const migratorUrl = new URL(fileEnv['MIGRATOR_DATABASE_URL'] ?? '');
  const port = Number(migratorUrl.port);
  const superuser = decodeURIComponent(migratorUrl.username);
  const superuserPassword = decodeURIComponent(migratorUrl.password);
  const dbName = migratorUrl.pathname.replace(/^\//, '');

  section(`1. Starting a REAL PostgreSQL instance (embedded-postgres, no Docker) on port ${port}`);
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, port, user: superuser, password: superuserPassword, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(dbName);
  console.log(`  postgres up on 127.0.0.1:${port}, database "${dbName}" created.`);

  section('2. Running migrations');
  runOrThrow('db:migrate', ['--filter', '@saas-inventory/api', 'run', 'db:migrate'], childEnv);

  section('3. Bootstrapping app_tenant / app_platform / app_public_resolver / app_event_processor role passwords');
  runOrThrow('db:bootstrap-dev-roles', ['--filter', '@saas-inventory/api', 'run', 'db:bootstrap-dev-roles'], childEnv);

  section('4. Starting the dev S3 shim, the API, and the Web dev servers');
  rmSync(S3_DATA_DIR, { recursive: true, force: true });
  spawnChild('dev-s3-shim (:9000)', 'node', [path.join(REPO_ROOT, 'scratchpad', 'dev-s3-shim.mjs')], childEnv);
  spawnChild('api (:4000)', 'pnpm', ['--filter', '@saas-inventory/api', 'dev'], childEnv);
  spawnChild('web (:3000)', 'pnpm', ['--filter', '@saas-inventory/web', 'dev'], childEnv);

  section('5. Waiting for the API to come up (GET /health)');
  const healthy = await waitForHealth('http://127.0.0.1:4000/health', 90_000);
  if (!healthy) {
    console.log('  [WARN] API did not report healthy within 90s — check its logs above.');
  } else {
    console.log('  API is healthy.');
    await registerQaAdmin('http://127.0.0.1:4000');
  }

  section('READY');
  console.log('  Web:  http://localhost:3000');
  console.log('  API:  http://localhost:4000  (docs: http://localhost:4000/docs)');
  console.log('  S3:   http://localhost:9000  (dev shim)');
  console.log('  Postgres: 127.0.0.1:55432 / saas_inventory_dev');
  console.log('\n  Press Ctrl+C to stop everything and wipe the ephemeral database.\n');
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

main().catch((error: unknown) => {
  console.error('dev-server failed:', error);
  void shutdown();
});
