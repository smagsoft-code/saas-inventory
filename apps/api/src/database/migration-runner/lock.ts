import { DEFAULT_LOCK_TIMEOUT_SECONDS, MAX_LOCK_TIMEOUT_SECONDS } from '../migration-integrity/config';
import type { Queryable } from './rls-window';

export { DEFAULT_LOCK_TIMEOUT_SECONDS, MAX_LOCK_TIMEOUT_SECONDS };

/**
 * Mutual exclusion between migration runs on the same database (ADR-0041, D-8C, audit finding H6).
 *
 * Mechanism: a SESSION-level advisory lock, `pg_try_advisory_lock(classid, objid)`, taken by polling until a stated timeout.
 *
 * Why session-level and not transaction-level. One wrapper run spans several transactions on one physical connection
 * (`max: 1`): the reads, Drizzle's own batch transaction, and the provisioning transaction. A transaction-level lock would
 * be released at the first commit or rollback, leaving the rest of the run unprotected (and an outer transaction around
 * everything is not possible: `drizzle(tx)` does not accept one). A session lock is untouched by commit and rollback, and
 * PostgreSQL releases it by itself when the session ends — normal close, error, or the client process dying — so it cannot
 * be left behind permanently.
 *
 * Why polling `pg_try_advisory_lock` and not a blocking `pg_advisory_lock`. The wait gets an explicit, reportable timeout
 * and a diagnostic that names the holder, instead of an unbounded block (or a session-wide `lock_timeout` setting).
 *
 * Scope. Advisory locks are per database: the lock is identified by `(current database, classid, objid, objsubid=2)`, so two
 * different databases never block each other, and two runs on the SAME database always do — whichever mode, and also
 * `--provision-only`. The two-integer form lives in a key space separate from the one-bigint form that the application's own
 * `pg_advisory_xact_lock(hashtext(...))` calls use, so they cannot collide with it.
 *
 * Limits (documented, not hidden): it protects only runs that go through this wrapper — `drizzle-kit migrate`/`push` or a
 * hand-written `migrate()` do not take it. A connection pooler in transaction mode (PgBouncer) would break session locks;
 * the wrapper connects directly. If the client dies in the middle of a statement, the server keeps the session (and so the
 * lock) until that statement ends and it notices the closed socket.
 */

/** 'SIMG' (0x53494d47): the class of migration locks. Fits int4. */
export const MIGRATION_LOCK_CLASS = 0x53494d47;
export const MIGRATION_LOCK_OBJECT = 1;
/** `objsubid` PostgreSQL records for the two-integer advisory form (1 is the single-bigint form). */
export const MIGRATION_LOCK_OBJSUBID = 2;

const DEFAULT_POLL_MS = 250;

export interface AcquiredLock {
  readonly acquiredAt: number;
  readonly waitedMs: number;
  /** Releases explicitly; the session end would do it anyway. `released` is false if the lock was not held by this session. */
  release(): Promise<{ released: boolean; releasedAt: number }>;
}

export type LockOutcome =
  | { readonly acquired: true; readonly lock: AcquiredLock }
  | { readonly acquired: false; readonly waitedMs: number; readonly holder: string | undefined };

export interface AcquireOptions {
  readonly timeoutMs: number;
  readonly pollMs?: number;
  /** Called once, on the first failed attempt, with a description of the holder when it can be seen. */
  readonly onWait?: (holder: string | undefined) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Who holds it, as far as the current role may see. Never throws: it is only for the message. */
async function describeHolder(sql: Queryable): Promise<string | undefined> {
  try {
    const rows = await sql.unsafe<{ pid: number; application_name: string | null; backend_start: Date | string | null }[]>(
      `SELECT l.pid, a.application_name, a.backend_start
         FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND l.granted
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = $1::oid AND l.objid = $2::oid AND l.objsubid = ${MIGRATION_LOCK_OBJSUBID}
        LIMIT 1`,
      [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const app = row.application_name !== null && row.application_name !== '' ? `, ${row.application_name}` : '';
    const since = row.backend_start !== null ? `, session started ${new Date(row.backend_start).toISOString()}` : '';
    return `backend pid ${row.pid}${app}${since}`;
  } catch {
    return undefined;
  }
}

export async function acquireMigrationLock(sql: Queryable, options: AcquireOptions): Promise<LockOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const started = now();
  let announced = false;

  for (;;) {
    const rows = await sql.unsafe<{ ok: boolean }[]>('SELECT pg_try_advisory_lock($1, $2) AS ok', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT]);
    if (rows[0]?.ok === true) {
      const acquiredAt = now();
      return {
        acquired: true,
        lock: {
          acquiredAt,
          waitedMs: acquiredAt - started,
          release: async () => {
            const released = await sql.unsafe<{ ok: boolean }[]>('SELECT pg_advisory_unlock($1, $2) AS ok', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT]);
            return { released: released[0]?.ok === true, releasedAt: now() };
          },
        },
      };
    }
    const elapsed = now() - started;
    const holder = announced ? undefined : await describeHolder(sql);
    if (!announced) {
      announced = true;
      options.onWait?.(holder);
    }
    if (elapsed >= options.timeoutMs) {
      return { acquired: false, waitedMs: elapsed, holder: holder ?? (await describeHolder(sql)) };
    }
    await sleep(Math.min(pollMs, Math.max(1, options.timeoutMs - elapsed)));
  }
}
