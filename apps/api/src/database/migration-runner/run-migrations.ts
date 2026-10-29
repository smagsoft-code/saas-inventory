import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { resolveMigratorConfig, type MigratorEnv } from '../migration-integrity/config';
import { APP_MIGRATOR_ROLE, assessExecution, expectedStartingRole, formatDiagnostics, evaluateIdentity, type IdentityFacts } from '../migration-integrity/execution-guard';
import { classifyHistory } from '../migration-integrity/history-classifier';
import { validateAgainstHistoryManifest, validateClassifications } from '../migration-integrity/history-manifest';
import { validateJournal } from '../migration-integrity/journal-validator';
import { DEFAULT_MIGRATIONS_DIR, readMigrationsFolder, type MigrationsFolder } from '../migration-integrity/migration-files';
import { findUndeclaredPrivileged, privilegedTags, validatePrivilegedManifest } from '../migration-integrity/privileged-manifest';
import { diagnostic, type Diagnostic } from '../migration-integrity/types';
import { readHistoryFacts, readIdentityFacts, setMigratorRole, type DatabaseHistoryFacts } from './db-facts';
import { evaluateInvariants, type InvariantSnapshot } from '../migration-integrity/invariants';
import {
  PreCommitInvariantError,
  invariantCheckFailed,
  isPreCommitInvariantError,
  snapshotInvariants,
  withPreCommitGuard,
  type PreCommitGuard,
} from './invariants';
import { PARSER_INFO, applyExceptions, countBySeverity, isOpen, lintMigrations, loadSqlParser, lowCertaintyCount, type LintFinding, type SqlParser } from '../migration-integrity/sql-lint';
import { acquireMigrationLock, type AcquiredLock } from './lock';
import { provisionIncrementalLogin } from './provision';
import type { Queryable } from './rls-window';

/**
 * The migration wrapper (ADR-0041, S3). `db:migrate` calls this instead of calling Drizzle directly.
 *
 * Order — Drizzle runs only at step 7, and only if every earlier step passed; a refusal at any step
 * has executed nothing and repaired nothing:
 *  1. resolve the mode and the configuration from the environment (no connection yet);
 *  2. validate the files — journal, history manifest (hashes, explicit classification, review
 *     evidence), privileged manifest, undeclared privileged statements. Done BEFORE connecting: a
 *     broken reference needs no database to be refused;
 *  3. connect with the one login of the chosen mode (a single connection: `SET ROLE` is per session);
 *  4. read the identity facts — database, `session_user`, `current_user`, role attributes, membership;
 *  5. incremental mode: `SET ROLE app_migrator` when the membership allows it; bootstrap mode: the
 *     same, but only when migration 0000 is not pending (0000 creates the role and issues its own
 *     `SET ROLE`), then re-read `current_user`;
 *  6. read the Drizzle registry and the table count, and assess the whole state (mode required by
 *     what is pending, identity, registry an exact prefix of the journal);
 *  7. apply the pending migrations with Drizzle's own `migrate()`: one transaction for the whole batch;
 *  8. verify the final state (registry equals the journal, `current_user`), and, in bootstrap mode with
 *     the incremental login configured, create/configure it and narrow the grants (`provision.ts`).
 *
 * Output never contains a connection string or a password: the configuration module keeps them out of
 * every message, and database errors are reduced to their SQLSTATE and message.
 */

export interface RunOptions {
  readonly env: MigratorEnv;
  /** `bootstrap` | `incremental` (from `--mode`); inferred when exactly one login is configured. */
  readonly requestedMode?: string | undefined;
  readonly migrationsDir?: string;
  /**
   * Bootstrap mode only: create/configure the incremental login and narrow the grants, WITHOUT applying
   * migrations. It is how an existing database adopts the incremental login while ordinary migrations
   * are still pending (bootstrap mode would otherwise refuse them: `MODE_BOOTSTRAP_NOT_REQUIRED`).
   * The history must still be a consistent prefix of the journal.
   */
  readonly provisionOnly?: boolean;
  /**
   * TEST ONLY. Production code never sets it (`migrate.ts` does not): it turns off the pre-commit invariant guard so the
   * harness can show what a violation that is detected only AFTER the commit leaves behind.
   */
  readonly disablePreCommitGuardForTests?: boolean;
  /** TEST ONLY, like the one above: lets the harness exercise the dynamic guards on SQL that the linter would refuse first. Never set by `migrate.ts`. */
  readonly disableSqlLintForTests?: boolean;
  /**
   * Dependency injection of the SQL parser, so a test can make it fail. `migrate.ts` never passes it, so the real parser
   * (libpg-query) is always used in practice. It is NOT a bypass: a parser that fails REFUSES the run (SQL_LINT_PARSER_UNAVAILABLE).
   */
  readonly sqlParserLoader?: () => Promise<SqlParser>;
  readonly log?: (line: string) => void;
  readonly logError?: (line: string) => void;
}

export interface RunResult {
  readonly exitCode: 0 | 1;
  /** Where it stopped (or `done`). */
  readonly stage: 'config' | 'files' | 'connect' | 'lock' | 'assess' | 'lint' | 'migrate' | 'postcheck' | 'provision' | 'done';
  readonly mode?: 'bootstrap' | 'incremental';
  /** Tags Drizzle applied in this run. */
  readonly applied: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  /** Epoch-ms timestamps of the migration lock this run held (filled in as the run proceeds; the object is final when the promise resolves). */
  readonly lock: LockTimes;
}

export interface LockTimes {
  acquiredAt: number | undefined;
  releasedAt: number | undefined;
  /** True when the explicit unlock found the lock held by this session. */
  released: boolean | undefined;
  waitedMs: number | undefined;
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: unknown; message?: unknown; severity?: unknown; name?: unknown };
    // A PostgreSQL error message describes the statement's failure; other errors may carry a host.
    if (typeof e.severity === 'string' && typeof e.message === 'string') return `${String(e.code)}: ${e.message}`;
    if (typeof e.code === 'string') return e.code;
    if (typeof e.name === 'string') return e.name;
  }
  return 'unknown error';
}

function staticDiagnostics(folder: MigrationsFolder): Diagnostic[] {
  const out: Diagnostic[] = [...folder.diagnostics];
  if (folder.historyManifest === null || folder.privilegedManifest === null) return out;
  out.push(
    ...validateJournal(folder.journal, folder.fileHashes),
    ...validateAgainstHistoryManifest(folder.journal, folder.fileHashes, folder.historyManifest),
    ...validateClassifications(folder.historyManifest, privilegedTags(folder.privilegedManifest)),
    ...validatePrivilegedManifest(folder.privilegedManifest, folder.journal, folder.fileHashes),
    ...findUndeclaredPrivileged(folder.privilegedManifest, folder.journal, folder.sqlByTag),
  );
  return out;
}

export async function runMigrations(options: RunOptions): Promise<RunResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const logError = options.logError ?? ((line: string) => console.error(line));
  const dir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const lockTimes: LockTimes = { acquiredAt: undefined, releasedAt: undefined, released: undefined, waitedMs: undefined };
  const fail = (stage: RunResult['stage'], diagnostics: readonly Diagnostic[], mode?: 'bootstrap' | 'incremental', applied: readonly string[] = []): RunResult => {
    if (diagnostics.length > 0) logError(`Migration run refused at ${stage}; nothing was repaired.\n${formatDiagnostics(diagnostics)}`);
    return { exitCode: 1, stage, applied, diagnostics, lock: lockTimes, ...(mode !== undefined ? { mode } : {}) };
  };

  // 1. configuration
  const resolution = resolveMigratorConfig(options.env, options.requestedMode);
  for (const warning of resolution.warnings) logError(`WARNING: ${warning}`);
  const config = resolution.config;
  if (config === null) return fail('config', resolution.diagnostics);
  const mode = config.mode;
  if (options.provisionOnly === true && (mode !== 'bootstrap' || !config.provisionIncrementalLogin)) {
    return fail('config', [diagnostic('CONFIG_VARIABLE_CONFLICT', '--provision-only needs bootstrap mode with MIGRATOR_INCREMENTAL_LOGIN and MIGRATOR_INCREMENTAL_PASSWORD.')], mode);
  }

  // 2. files
  const folder = readMigrationsFolder(dir);
  const fileProblems = staticDiagnostics(folder);
  if (fileProblems.length > 0 || folder.historyManifest === null || folder.privilegedManifest === null) return fail('files', fileProblems, mode);
  const { journal, fileHashes, registryHashCandidates, sqlByTag, historyManifest, privilegedManifest, lintExceptions } = folder;

  // 3. connect (one connection)
  const sql: Sql = postgres(config.connectionUrl, { max: 1, onnotice: () => undefined, connect_timeout: 10, connection: { application_name: 'saas-inventory-migrator' } });
  const executionConfig = {
    requestedMode: mode,
    expectedDatabase: config.expectedDatabase,
    willRunMigrations: options.provisionOnly !== true,
    ...(config.bootstrapLogin !== undefined ? { bootstrapLogin: config.bootstrapLogin } : {}),
    ...(config.incrementalLogin !== undefined ? { incrementalLogin: config.incrementalLogin } : {}),
  };

  let lockHandle: AcquiredLock | undefined;
  try {
    // 4. identity
    let facts: IdentityFacts;
    try {
      facts = await readIdentityFacts(sql);
    } catch (error) {
      return fail('connect', [diagnostic('FACTS_UNAVAILABLE', `Could not connect or read the identity facts (${describeError(error)}); PostgreSQL 16 or later is required.`)], mode);
    }
    // Refuse a wrong database BEFORE going any further (nothing else is read from it).
    if (facts.database !== config.expectedDatabase) {
      return fail('assess', evaluateIdentity(mode, facts, executionConfig, []), mode);
    }

    // 4b. MUTUAL EXCLUSION. Everything that depends on the state of the database — the history, the invariant baseline, the
    //     identity facts, the batch itself, the final check and the provisioning transaction — happens while this session
    //     holds the migration lock, so a second run can never evaluate a baseline that the first is about to change.
    //     --provision-only takes the same lock, and so does every mode.
    const acquired = await acquireMigrationLock(sql, {
      timeoutMs: config.lockTimeoutSeconds * 1000,
      onWait: (holder) =>
        log(`Waiting for the migration lock of database "${facts.database}"${holder !== undefined ? ` (held by ${holder})` : ''}; giving up after ${config.lockTimeoutSeconds}s.`),
    });
    if (!acquired.acquired) {
      return fail(
        'lock',
        [
          diagnostic(
            'LOCK_NOT_ACQUIRED',
            `Another migration run holds the lock of database "${facts.database}"${acquired.holder !== undefined ? ` (${acquired.holder})` : ''}; waited ${Math.round(acquired.waitedMs / 100) / 10}s of ${config.lockTimeoutSeconds}s. Nothing was evaluated, changed or repaired. Retry when it finishes, or raise MIGRATOR_LOCK_TIMEOUT_SECONDS.`,
            { details: { waitedMs: acquired.waitedMs, timeoutSeconds: config.lockTimeoutSeconds } },
          ),
        ],
        mode,
      );
    }
    lockHandle = acquired.lock;
    lockTimes.acquiredAt = acquired.lock.acquiredAt;
    lockTimes.waitedMs = acquired.lock.waitedMs;
    if (acquired.lock.waitedMs > 0) log(`Migration lock acquired after waiting ${Math.round(acquired.lock.waitedMs / 100) / 10}s; the state is evaluated now, not before.`);
    // What was read while waiting may be stale (a role, a privilege): read the identity facts again under the lock.
    facts = await readIdentityFacts(sql);
    if (facts.database !== config.expectedDatabase) {
      return fail('assess', evaluateIdentity(mode, facts, executionConfig, []), mode);
    }

    // 5/6. role and history
    const readHistory = async (): Promise<DatabaseHistoryFacts | Diagnostic> => {
      try {
        return await readHistoryFacts(sql);
      } catch (error) {
        return diagnostic('REGISTRY_UNREADABLE', `The migration registry or the table list could not be read as "${facts.currentUser}" (${describeError(error)}).`);
      }
    };
    const trySetRole = async (): Promise<void> => {
      if (facts.currentUser === APP_MIGRATOR_ROLE || !facts.appMigratorRoleExists) return;
      if (mode === 'incremental' && !facts.sessionHasSetMembership) return;
      try {
        await setMigratorRole(sql);
      } catch {
        return; // the identity assessment below reports what is wrong
      }
      facts = await readIdentityFacts(sql);
    };

    let history: DatabaseHistoryFacts | Diagnostic;
    if (mode === 'incremental') {
      await trySetRole();
      history = await readHistory();
    } else {
      history = await readHistory();
      if ('registry' in history) {
        const provisional = classifyHistory({
          journal,
          fileHashes,
          registryHashCandidates,
          registry: history.registry,
          publicTableCount: history.publicTableCount,
          privilegedTags: privilegedTags(privilegedManifest),
        });
        if (provisional.state !== 'INCONSISTENT' && provisional.state !== 'NEW' && expectedStartingRole(provisional.pending) === 'app_migrator') {
          await trySetRole();
        }
      }
    }
    if (!('registry' in history)) {
      return fail('assess', [...evaluateIdentity(mode, facts, executionConfig, []), history], mode);
    }

    const assessment = assessExecution({
      config: executionConfig,
      facts,
      journal,
      fileHashes,
      registryHashCandidates,
      sqlByTag,
      registry: history.registry,
      publicTableCount: history.publicTableCount,
      historyManifest,
      privilegedManifest,
    });
    // Provisioning an existing database does not need the privileged mode to be "required" by what is pending.
    const blocking = options.provisionOnly === true ? assessment.diagnostics.filter((d) => d.code !== 'MODE_BOOTSTRAP_NOT_REQUIRED') : assessment.diagnostics;
    if (blocking.length > 0) return fail('assess', blocking, mode);
    if (options.provisionOnly === true) {
      // Explicit preconditions of --provision-only, checked BEFORE anything is granted. (A NEW database used to be
      // refused only incidentally, by the final registry check.)
      const unmet: Diagnostic[] = [];
      if (assessment.classification.state === 'NEW') {
        unmet.push(
          diagnostic(
            'PROVISION_PRECONDITION_FAILED',
            'Precondition not met: the database has no applied migrations (state NEW). --provision-only adopts a database that already has its history; run bootstrap mode WITHOUT --provision-only first.',
          ),
        );
      } else if (!facts.appMigratorRoleExists) {
        unmet.push(
          diagnostic(
            'PROVISION_PRECONDITION_FAILED',
            'Precondition not met: the role "app_migrator" does not exist, so the history cannot have been applied by the standard migrations. Nothing was granted.',
          ),
        );
      }
      if (unmet.length > 0) return fail('assess', unmet, mode);
    }

    const pending = assessment.classification.pending;
    log(`Migration run: mode=${mode}, database=${facts.database}, session_user=${facts.sessionUser}, current_user=${facts.currentUser}, applied=${assessment.classification.appliedCount}, pending=${pending.length}.`);

    // 6b. SQL/RLS LINT of the migrations about to be applied — the very texts whose hashes were just validated (same read),
    //     before Drizzle can run anything. An open ERROR in ANY pending migration refuses the whole batch; nothing has been applied,
    //     so nothing is left half-done. The reviewed exceptions (sql-lint-exceptions.json, loaded with the other references and
    //     already shape-checked before connecting) are validated against the findings of EVERY journal migration — an exception
    //     may concern an already-applied one — and any problem with them refuses the run too. WARNINGs are summarised (never
    //     "safe"); INFO is only in the CLI report. --provision-only applies nothing and lints nothing.
    //     The exceptions are validated whenever any is loaded — also with NOTHING pending and also for --provision-only: an obsolete
    //     exception must not be ignored just because there is nothing to apply (D-8E). With an empty file and nothing pending the parser is
    //     not needed at all.
    const lintsPending = options.provisionOnly !== true && pending.length > 0;
    if ((lintsPending || lintExceptions.length > 0) && options.disableSqlLintForTests !== true) {
      let all: LintFinding[];
      try {
        all = lintMigrations(await (options.sqlParserLoader ?? loadSqlParser)(), journal, sqlByTag, historyManifest);
      } catch {
        // Fail safe: if the parser cannot be loaded (or crashes) nothing can be said about the SQL, so none of it is applied.
        return fail('lint', [diagnostic('SQL_LINT_PARSER_UNAVAILABLE', `The SQL parser (${PARSER_INFO.package}@${PARSER_INFO.version}) could not be loaded or crashed; the migrations cannot be linted, so none is applied.`)], mode);
      }
      const applied = applyExceptions(all, lintExceptions, fileHashes);
      if (applied.problems.length > 0) return fail('lint', applied.problems, mode);
      const pendingTags = new Set(lintsPending ? pending.map((e) => e.tag) : []);
      const findings = applied.findings.filter((f) => pendingTags.has(f.tag));
      const open = findings.filter(isOpen);
      const errors = open.filter((f) => f.severity === 'ERROR');
      if (errors.length > 0) {
        return fail(
          'lint',
          errors.map((f) =>
            diagnostic('SQL_LINT_ERROR', `[${f.ruleId}] ${f.tag}.sql${f.line !== null ? `:${f.line}` : ''} — ${f.message}`, {
              migration: f.tag,
              details: { rule: f.ruleId, line: f.line, certainty: f.certainty },
            }),
          ),
          mode,
        );
      }
      if (lintExceptions.length > 0) log(`SQL lint: ${lintExceptions.length} exception(s) validated against the current files (rule, migration, line and file hash all still match).`);
      // Nothing is applied by a run with no pending migration (or by --provision-only): the exceptions were checked above, there is no batch to lint.
      if (lintsPending) {
        const counts = countBySeverity(findings);
        const acceptedFindings = findings.filter((f) => !isOpen(f));
        const low = lowCertaintyCount(findings);
        const byRule = new Map<string, number>();
        for (const f of open) if (f.severity === 'WARNING') byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
        log(
          `SQL lint (${PARSER_INFO.grammar} grammar, ${PARSER_INFO.package}@${PARSER_INFO.version}): ${pending.length} pending migration(s), ${counts.ERROR} error(s), ${counts.WARNING} warning(s)${acceptedFindings.length > 0 ? `, ${acceptedFindings.length} accepted by exception` : ''}. A warning means "needs a human look", never "safe".${low > 0 ? ` ${low} finding(s) of low certainty: PL/pgSQL the parser cannot read, NOT confirmed by the syntax tree.` : ''}`,
        );
        for (const [rule, n] of [...byRule.entries()].sort()) log(`  warning ${rule} × ${n}`);
        // An accepted finding does not disappear: it is listed, with who accepted it and why.
        for (const f of acceptedFindings) {
          log(`  ACCEPTED ${f.severity} ${f.ruleId} ${f.tag}.sql${f.line !== null ? `:${f.line}` : ''} by ${f.accepted?.reviewedIn ?? '?'} — ${f.accepted?.reason ?? ''}`);
        }
      }
    }

    // 7. apply
    //   Drizzle commits its own batch transaction, so the owner / RLS / registry invariants are checked by a hook that
    //   runs INSIDE that transaction, after the last migration and before the commit (see ./invariants.ts). A violation
    //   there rolls the whole batch back. What cannot be inside it is reported after the commit, as such.
    const applied: string[] = [];
    let baseline: InvariantSnapshot | undefined;
    let guard: PreCommitGuard | undefined;
    const guardEnabled = options.disablePreCommitGuardForTests !== true;
    if (options.provisionOnly !== true) {
      try {
        baseline = await snapshotInvariants(sql);
      } catch (error) {
        return fail('assess', [invariantCheckFailed(error)], mode);
      }
      const existing = evaluateInvariants(baseline, baseline).preExisting;
      // A brand-new database always starts with a "public" schema owned by someone else; 0000 hands it over, so no warning.
      if (assessment.classification.state !== 'NEW' && existing.owner + existing.notForced > 0) {
        logError(
          `WARNING: pre-existing deviations, not blocking (MIG-OWNERSHIP-AUDIT): ${existing.owner} object(s) in "public" not owned by "${APP_MIGRATOR_ROLE}", ${existing.notForced} table(s) with RLS enabled but not FORCEd. Only new violations introduced by a run are refused.`,
        );
      }
    }
    if (options.provisionOnly === true) {
      log(`Provision only: ${pending.length} migration(s) stay pending and are NOT applied.`);
    } else if (pending.length > 0) {
      const before = baseline as InvariantSnapshot;
      const check = async (tx: Queryable): Promise<void> => {
        const problems: Diagnostic[] = [];
        try {
          const who = await tx.unsafe<{ u: string }[]>('SELECT current_user::text AS u');
          if (who[0]?.u !== APP_MIGRATOR_ROLE) {
            problems.push(diagnostic('INVARIANT_IDENTITY_UNEXPECTED', `At the end of the batch current_user is "${who[0]?.u ?? '?'}", expected "${APP_MIGRATOR_ROLE}".`));
          }
          const inside = await readHistoryFacts(tx);
          const state = classifyHistory({
            journal,
            fileHashes,
            registryHashCandidates,
            registry: inside.registry,
            publicTableCount: inside.publicTableCount,
            privilegedTags: privilegedTags(privilegedManifest),
          });
          if (state.state !== 'CONSISTENT' || state.pending.length > 0) {
            problems.push(diagnostic('INVARIANT_REGISTRY_MISMATCH', 'At the end of the batch the registry is not a complete, consistent prefix of the journal (the files Drizzle read may differ from the validated ones).'), ...state.diagnostics);
          }
          problems.push(...evaluateInvariants(before, await snapshotInvariants(tx)).blocking);
        } catch (error) {
          problems.push(invariantCheckFailed(error));
        }
        if (problems.length > 0) throw new PreCommitInvariantError(problems);
      };
      guard = guardEnabled ? withPreCommitGuard(sql, check) : undefined;
      try {
        await migrate(drizzle(guard?.client ?? sql), { migrationsFolder: dir });
        applied.push(...pending.map((e) => e.tag));
      } catch (error) {
        if (isPreCommitInvariantError(error)) {
          logError(
            'Rolled back BEFORE commit: no migration of this batch was applied. What remains committed regardless: when they did not exist yet, the schema "drizzle" and its empty registry table, which Drizzle creates before its transaction starts.',
          );
          return fail('migrate', error.diagnostics, mode);
        }
        const after = await readHistory().catch(() => undefined);
        const unchanged = after !== undefined && 'registry' in after && after.registry.kind === history.registry.kind
          && (after.registry.kind === 'absent' || (history.registry.kind === 'present' && after.registry.rows.length === history.registry.rows.length));
        logError(`Migration failed (${describeError(error)}). The batch is one transaction; registry unchanged: ${String(unchanged)}.`);
        return fail('migrate', [diagnostic('POSTCHECK_FAILED', `Drizzle failed while applying ${pending.length} migration(s); registry unchanged: ${String(unchanged)}.`)], mode);
      }
    } else {
      log('Nothing to apply: the registry already matches the journal.');
    }

    // 8. verify the final state
    const finalFacts = await readIdentityFacts(sql);
    const finalHistory = await readHistory();
    if (!('registry' in finalHistory)) return fail('postcheck', [finalHistory], mode, applied);
    const finalState = classifyHistory({
      journal,
      fileHashes,
      registryHashCandidates,
      registry: finalHistory.registry,
      publicTableCount: finalHistory.publicTableCount,
      privilegedTags: privilegedTags(privilegedManifest),
    });
    const postProblems: Diagnostic[] = [...finalState.diagnostics];
    if (finalState.state !== 'CONSISTENT' || (options.provisionOnly !== true && finalState.pending.length > 0)) {
      postProblems.push(diagnostic('POSTCHECK_FAILED', 'After the run the registry is not a complete, consistent prefix of the journal.'));
    }
    if (applied.length > 0 && finalFacts.currentUser !== APP_MIGRATOR_ROLE) {
      postProblems.push(diagnostic('POSTCHECK_FAILED', `After the run current_user is "${finalFacts.currentUser}", expected "${APP_MIGRATOR_ROLE}".`));
    }
    // Owner / RLS invariants once more, now on committed state. With the guard working this finds nothing new; it is
    // the only line of defence when the guard was bypassed, and by then the batch is COMMITTED.
    if (baseline !== undefined) {
      try {
        postProblems.push(...evaluateInvariants(baseline, await snapshotInvariants(sql)).blocking);
      } catch (error) {
        postProblems.push(invariantCheckFailed(error));
      }
      if (guardEnabled && applied.length > 0 && (guard?.invocations() ?? 0) === 0) {
        postProblems.push(diagnostic('INVARIANT_GUARD_NOT_INVOKED', 'The pre-commit invariant guard did not run for a batch that applied migrations (a drizzle-orm change?): the batch was committed without it.'));
      }
    }
    if (postProblems.length > 0) {
      if (applied.length > 0) {
        logError(
          `These changes are ALREADY COMMITTED: ${applied.length} migration(s) stay applied. Nothing was rolled back and nothing was repaired; the violation(s) below describe the database as it now is.`,
        );
      }
      return fail('postcheck', postProblems, mode, applied);
    }
    if (options.provisionOnly !== true) log(`Migrations applied successfully: ${applied.length} in this run, ${finalState.appliedCount} in total.`);

    // 8b. bootstrap: the incremental login and the narrowed grants
    if (config.provisionIncrementalLogin && config.incrementalLogin !== undefined && config.incrementalPassword !== undefined) {
      try {
        // The session user is the verified superuser of bootstrap mode; leave the app_migrator role
        // explicitly and say so, rather than letting a migration's RESET ROLE do it implicitly.
        await sql.unsafe('RESET ROLE');
        const result = await provisionIncrementalLogin(sql, config.incrementalLogin, config.incrementalPassword);
        log(`Incremental login "${result.login}" ${result.loginCreated ? 'created' : 'reconfigured'}; app_migrator membership (SET only), CREATE on the database and the narrowed Drizzle grants are in place.`);
      } catch (error) {
        return fail('provision', [diagnostic('POSTCHECK_FAILED', `Provisioning the incremental login failed (${describeError(error)}). The migrations were applied.`)], mode, applied);
      }
    }
    return { exitCode: 0, stage: 'done', mode, applied, diagnostics: [], lock: lockTimes };
  } finally {
    // The lock is released explicitly while the connection is still good; if that fails (a dead connection) closing the
    // session releases it anyway — it is a session-level advisory lock.
    if (lockHandle !== undefined) {
      try {
        const released = await lockHandle.release();
        lockTimes.releasedAt = released.releasedAt;
        lockTimes.released = released.released;
      } catch {
        lockTimes.releasedAt = Date.now();
      }
    }
    await sql.end({ timeout: 5 });
  }
}
