/**
 * Local DEVELOPMENT bring-up (D-8E.24) — NOT the CI verification harness (`verify-real-postgres.ts`, which uses its own
 * disposable database). Starts a REAL, Docker-free local PostgreSQL (embedded-postgres) matching the values of the repo root
 * `.env`, then the dev S3 shim, the API and the Web dev servers as child processes.
 *
 * The database is PERSISTENT. This script never deletes it:
 *   - the data directory (`scratchpad/.dev-pgdata`, or DEV_PGDATA_DIR) is initialised only if it is missing or empty;
 *   - a directory with a completed initialisation (marker `<dir>.initialized`) is started as it is and verified (migrations run on top;
 *     nothing is re-seeded);
 *   - a half-initialised directory, an older one with no marker, or one that is not PostgreSQL makes the script stop without touching
 *     it; recovery is explicit and non-destructive: `dev --finish-init` / `dev --adopt` (see dev-init.ts and the README);
 *   - if the port is already in use (e.g. the database is already running, started by _dev-start-postgres-only.mjs) the
 *     script stops without touching anything;
 *   - Ctrl+C stops every child process and PostgreSQL; the data stays on disk. The dev S3 shim data
 *     (`scratchpad/s3data`, product images) is kept too.
 *
 * The QA admin is registered ONLY on the first start of a new, empty data directory, and its password comes from
 * QA_ADMIN_PASSWORD (environment or the git-ignored .env) — it is required before anything is created, has no default and is
 * never printed. To rotate or recreate it, see tools/pg-verify/README.md.
 *
 * To throw the development data away you must delete the directory yourself, on purpose, after a backup.
 *
 * Usage: pnpm --filter @saas-inventory/pg-verify dev [--finish-init | --adopt]
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type EmbeddedPostgres from 'embedded-postgres';
import { decideStart, inspectDevDir, parseStartFlags, prepareDevCluster } from './dev-init';
import { resolveDevDataDir } from './env-guard';
import { loadQaAdmin, parseEnvText, type QaAdmin } from './qa-credentials';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DATA_DIR = resolveDevDataDir(REPO_ROOT, process.env);

/** `KEY=VALUE` lines of the root `.env` (same minimal format as `qa-credentials.ts`). */
function parseEnvFile(filePath: string): Record<string, string> {
  return parseEnvText(readFileSync(filePath, 'utf8'));
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

async function registerQaAdmin(apiUrl: string, qaAdmin: QaAdmin): Promise<void> {
  section('Provisioning the QA admin login of a NEW development database (real POST /api/v1/auth/register)');
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(qaAdmin),
    });
    if (!response.ok) {
      // The response body is not echoed: it could repeat what was sent.
      console.log(`  [WARN] register returned ${response.status}.`);
      console.log('  You can still register manually at http://localhost:3000/register');
      return;
    }
    // The password is never printed: it is the one you set in QA_ADMIN_PASSWORD.
    console.log(`  QA admin ready — log in at http://localhost:3000/login as ${qaAdmin.email} (password: your QA_ADMIN_PASSWORD).`);
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
  section('Shutting down — stopping every child process and PostgreSQL; the development data stays on disk');
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  if (pg) {
    await pg.stop().catch((error: unknown) => console.error('  postgres stop failed:', error));
  }
  // Deliberately no deletion of any directory here (D-8E.24): this also runs after a failed start.
  process.exit(0);
}

async function main(): Promise<void> {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath} — copy .env.example to .env first.`);
  }
  const fileEnv = parseEnvFile(envPath);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };

  // One contract for every migrator consumer: MIGRATOR_BOOTSTRAP_DATABASE_URL, or the deprecated MIGRATOR_DATABASE_URL; both is an error.
  const bootstrapText = fileEnv['MIGRATOR_BOOTSTRAP_DATABASE_URL'] ?? '';
  const legacyText = fileEnv['MIGRATOR_DATABASE_URL'] ?? '';
  if (bootstrapText !== '' && legacyText !== '') {
    throw new Error('Set MIGRATOR_BOOTSTRAP_DATABASE_URL or the deprecated MIGRATOR_DATABASE_URL in .env, not both.');
  }
  if (bootstrapText === '' && legacyText === '') {
    throw new Error('Missing MIGRATOR_BOOTSTRAP_DATABASE_URL in .env (copy it from .env.example).');
  }
  const migratorUrl = new URL(bootstrapText !== '' ? bootstrapText : legacyText);
  const port = Number(migratorUrl.port);
  const superuser = decodeURIComponent(migratorUrl.username);
  const superuserPassword = decodeURIComponent(migratorUrl.password);
  const dbName = migratorUrl.pathname.replace(/^\//, '');
  // This tool creates the database named in that URL itself, so it is the one safe place to default the wrapper's
  // required MIGRATOR_EXPECTED_DATABASE to it; an explicit value in .env still wins (and is still checked).
  if ((childEnv['MIGRATOR_EXPECTED_DATABASE'] ?? '') === '') childEnv['MIGRATOR_EXPECTED_DATABASE'] = dbName;

  // Everything that can refuse runs BEFORE anything is created or started, and none of it deletes anything (see dev-init.ts).
  const flags = parseStartFlags(process.argv.slice(2));
  const action = decideStart(inspectDevDir(DATA_DIR), flags, DATA_DIR);
  const qaAdmin = action === 'initialize' ? loadQaAdmin({ ...fileEnv, ...process.env }) : undefined;

  section(`1. Development PostgreSQL (embedded-postgres, no Docker) on port ${port}: ${action}`);
  console.log(`  data directory: ${DATA_DIR}`);
  const cluster = await prepareDevCluster({ dataDir: DATA_DIR, port, user: superuser, password: superuserPassword, dbName, flags });
  pg = cluster.pg;
  console.log(`  postgres up on 127.0.0.1:${port}, database "${dbName}" ${cluster.created ? 'created' : 'in use'} (verified).`);

  section('2. Running migrations');
  runOrThrow('db:migrate', ['--filter', '@saas-inventory/api', 'run', 'db:migrate'], childEnv);

  section('3. Bootstrapping app_tenant / app_platform / app_public_resolver / app_event_processor role passwords');
  runOrThrow('db:bootstrap-dev-roles', ['--filter', '@saas-inventory/api', 'run', 'db:bootstrap-dev-roles'], childEnv);

  section('4. Starting the dev S3 shim, the API, and the Web dev servers');
  spawnChild('dev-s3-shim (:9000)', 'node', [path.join(REPO_ROOT, 'scratchpad', 'dev-s3-shim.mjs')], childEnv);
  spawnChild('api (:4000)', 'pnpm', ['--filter', '@saas-inventory/api', 'dev'], childEnv);
  spawnChild('web (:3000)', 'pnpm', ['--filter', '@saas-inventory/web', 'dev'], childEnv);

  section('5. Waiting for the API to come up (GET /health)');
  const healthy = await waitForHealth('http://127.0.0.1:4000/health', 90_000);
  if (!healthy) {
    console.log('  [WARN] API did not report healthy within 90s — check its logs above.');
  } else {
    console.log('  API is healthy.');
    if (cluster.created && qaAdmin) await registerQaAdmin('http://127.0.0.1:4000', qaAdmin);
  }

  section('READY');
  console.log('  Web:  http://localhost:3000');
  console.log('  API:  http://localhost:4000  (docs: http://localhost:4000/docs)');
  console.log('  S3:   http://localhost:9000  (dev shim)');
  console.log(`  Postgres: 127.0.0.1:${port} / ${dbName}  (persistent: ${DATA_DIR})`);
  console.log('\n  Press Ctrl+C to stop everything. The database and its data stay on disk.\n');
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

main().catch((error: unknown) => {
  console.error('dev-server failed:', error);
  void shutdown();
});
