/**
 * Explicit rebuild of the TESTING environment (D-8E.24): deletes the disposable testing data directory
 * (`tools/pg-verify/.verify-pgdata`) and nothing else. The next `pnpm verify` creates it again from scratch.
 *
 * It refuses — and deletes nothing — if the directory is not provably the disposable one (see env-guard.ts), if it overlaps the
 * development data directory, if it is marked `.persistent`, or if a server is still listening on the testing port.
 * It never connects to any database and never touches the development environment.
 *
 * Usage: pnpm --filter @saas-inventory/pg-verify test:db:reset
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPortFree, assertTestingTarget, DEFAULT_TESTING_PORT, removeDisposableDir, resolveDevDataDir } from './env-guard';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const TESTING_DIR = path.resolve(HERE, '.verify-pgdata');
const PORT = Number(process.env['PG_VERIFY_PORT'] ?? DEFAULT_TESTING_PORT);

async function main(): Promise<void> {
  const devDataDir = resolveDevDataDir(REPO_ROOT, process.env);
  // The target is validated BEFORE any port is probed or anything is deleted: a protected port (the development one) is refused outright.
  assertTestingTarget({ port: PORT, dataDir: TESTING_DIR, dbName: 'saas_inventory_verify' }, devDataDir);
  await assertPortFree(PORT); // a running testing server must be stopped first
  const removed = removeDisposableDir(TESTING_DIR, devDataDir);
  console.log(removed ? `Testing environment reset: removed ${TESTING_DIR}.` : `Nothing to reset: ${TESTING_DIR} does not exist.`);
  console.log(`Development data (${devDataDir}) was not touched.`);
}

main().catch((error: unknown) => {
  console.error('test:db:reset refused:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
