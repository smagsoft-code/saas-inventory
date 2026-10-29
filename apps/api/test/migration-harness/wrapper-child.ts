import { runMigrations } from '../../src/database/migration-runner/run-migrations';

/**
 * One independent OS process running the real wrapper (`runMigrations`) — what the lock tests of the harness spawn, because
 * two runs in the SAME process would not show a cross-process exclusion. Not a test file. Usage:
 *   node --import tsx test/migration-harness/wrapper-child.ts <migrations folder> [--provision-only] [--mode <m>]
 * The configuration comes from the MIGRATOR_* variables of its environment; every output line is prefixed with the epoch-ms
 * at which it was printed, and the last line is `RESULT:<json>` (no secrets: counts, codes and timestamps).
 */
async function main(): Promise<void> {
  const [dir, ...flags] = process.argv.slice(2);
  if (dir === undefined) throw new Error('usage: wrapper-child.ts <migrations folder>');
  const out = (line: string) => console.log(`[${Date.now()}] ${line}`);
  const modeAt = flags.indexOf('--mode');
  const result = await runMigrations({
    env: process.env,
    migrationsDir: dir,
    provisionOnly: flags.includes('--provision-only'),
    requestedMode: modeAt >= 0 ? flags[modeAt + 1] : undefined,
    log: out,
    logError: out,
  });
  console.log(
    `RESULT:${JSON.stringify({ exitCode: result.exitCode, stage: result.stage, applied: result.applied.length, codes: result.diagnostics.map((d) => d.code), lock: result.lock })}`,
  );
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  console.error(`child failed (${error instanceof Error ? error.name : 'unknown'})`);
  process.exitCode = 2;
});
