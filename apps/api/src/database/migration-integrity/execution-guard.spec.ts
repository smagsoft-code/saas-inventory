import { describe, expect, it } from 'vitest';
import {
  assessExecution,
  evaluateIdentity,
  expectedStartingRole,
  formatDiagnostics,
  type ExecutionConfig,
  type ExecutionInput,
  type IdentityFacts,
} from './execution-guard';
import {
  bootstrapFacts,
  historyManifestFor,
  incrementalFacts,
  makeFiles,
  makeJournal,
  must,
  privilegedManifestFor,
  registryRows,
  TAG_0019,
} from './fixtures';
import type { DiagnosticCode } from './types';

const journal = makeJournal(30);
const files = makeFiles(journal);

function input(over: {
  mode?: ExecutionConfig['requestedMode'];
  applied?: number | 'none' | 'absent';
  tables?: number;
  facts?: IdentityFacts;
  config?: Partial<ExecutionConfig>;
  files?: typeof files;
  historyFiles?: typeof files;
} = {}): ExecutionInput {
  const mode = over.mode ?? 'incremental';
  const applied = over.applied ?? 22;
  const f = over.files ?? files;
  return {
    config: { requestedMode: mode, expectedDatabase: 'app', ...over.config },
    facts: over.facts ?? (mode === 'incremental' ? incrementalFacts() : bootstrapFacts()),
    journal,
    fileHashes: f.fileHashes,
    registryHashCandidates: f.registryHashCandidates,
    sqlByTag: f.sqlByTag,
    registry: applied === 'absent' ? { kind: 'absent' } : { kind: 'present', rows: registryRows(journal, applied === 'none' ? 0 : applied, files) },
    publicTableCount: over.tables ?? (applied === 'absent' || applied === 'none' ? 0 : 54),
    historyManifest: historyManifestFor(journal, over.historyFiles ?? files),
    privilegedManifest: privilegedManifestFor(files),
  };
}
const codes = (i: ExecutionInput): DiagnosticCode[] => assessExecution(i).diagnostics.map((d) => d.code);

describe('assessExecution — allowed runs', () => {
  it('incremental: ordinary migrations pending, registry a prefix, correct limited identity', () => {
    const r = assessExecution(input());
    expect(r.allowed).toBe(true);
    expect(r.requiredMode).toBe('incremental');
    expect(r.classification.pending).toHaveLength(8);
  });

  it('bootstrap: a new database, superuser login, current_user = session_user (0000 sets its own role)', () => {
    const r = assessExecution(input({ mode: 'bootstrap', applied: 'absent' }));
    expect(r.allowed).toBe(true);
    expect(r.requiredMode).toBe('bootstrap');
  });

  it('bootstrap: privileged 0019 pending on an existing database, started as app_migrator', () => {
    const facts = bootstrapFacts({ appMigratorRoleExists: true, appMigratorHasDatabaseCreate: true, currentUser: 'app_migrator', currentIsSuperuser: false, currentBypassRls: false });
    const r = assessExecution(input({ mode: 'bootstrap', applied: 10, facts }));
    expect(r.allowed).toBe(true);
    expect(r.classification.pending.map((e) => e.tag)).toContain(TAG_0019);
  });

  it('nothing pending: either mode passes the mode check (identity is still checked)', () => {
    expect(assessExecution(input({ applied: 30 })).allowed).toBe(true);
    expect(assessExecution(input({ mode: 'bootstrap', applied: 30, facts: bootstrapFacts({ appMigratorRoleExists: true }) })).requiredMode).toBeNull();
  });
});

describe('assessExecution — mode and state', () => {
  it('a new database cannot be migrated incrementally', () => {
    expect(codes(input({ mode: 'incremental', applied: 'absent' }))).toContain('MODE_NEW_DATABASE_REQUIRES_BOOTSTRAP');
  });

  it('a pending privileged migration is refused in incremental mode', () => {
    const r = assessExecution(input({ mode: 'incremental', applied: 10 }));
    expect(r.allowed).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain('PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE');
    expect(r.diagnostics.find((d) => d.code === 'PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE')?.details).toMatchObject({ pending: TAG_0019 });
  });

  it('ordinary migrations do not justify the superuser login', () => {
    const r = assessExecution(input({ mode: 'bootstrap', applied: 22, facts: bootstrapFacts({ appMigratorRoleExists: true, appMigratorHasDatabaseCreate: true, currentUser: 'app_migrator', currentIsSuperuser: false, currentBypassRls: false }) }));
    expect(r.diagnostics.map((d) => d.code)).toEqual(['MODE_BOOTSTRAP_NOT_REQUIRED']);
  });

  it('an inconsistent history aborts and requires no mode', () => {
    const rows = registryRows(journal, 22, files);
    rows.splice(3, 1);
    const i = { ...input(), registry: { kind: 'present', rows } } as ExecutionInput;
    const r = assessExecution(i);
    expect(r.allowed).toBe(false);
    expect(r.classification.state).toBe('INCONSISTENT');
    expect(r.requiredMode).toBeNull();
  });

  it('a registry that exists with tables missing, or the reverse, aborts', () => {
    expect(codes(input({ applied: 'absent', tables: 54 }))).toContain('REGISTRY_MISSING_WITH_TABLES');
    expect(codes(input({ applied: 'none', tables: 54 }))).toContain('REGISTRY_EMPTY_WITH_TABLES');
  });
});

describe('assessExecution — references', () => {
  it('a file edited after it was applied (registry hash differs) aborts', () => {
    const edited = makeFiles(journal, { [must(journal[4]).tag]: 'SELECT 7;\n' });
    const r = codes(input({ files: edited }));
    expect(r).toContain('HISTORY_HASH_MISMATCH');
    expect(r).toContain('MANIFEST_HASH_MISMATCH');
  });

  it('a migration missing from the history manifest aborts (an unrecorded new migration)', () => {
    const i = input();
    const shorter = { ...i, historyManifest: { ...i.historyManifest, entries: i.historyManifest.entries.slice(0, 29) } };
    expect(codes(shorter)).toContain('MANIFEST_ENTRY_MISSING');
  });

  it('a pending migration with an undeclared privileged statement aborts', () => {
    const sneaky = makeFiles(journal, { [must(journal[25]).tag]: 'CREATE ROLE sneaky;\n' });
    const i = input({ files: sneaky, historyFiles: sneaky });
    expect(codes({ ...i, registry: input().registry })).toContain('PRIVILEGED_STATEMENT_UNDECLARED');
  });

  it('a journal problem is reported once, not twice', () => {
    const broken = journal.map((e) => (e.idx === 12 ? { ...e, when: must(journal[11]).when } : e));
    const r = assessExecution({ ...input(), journal: broken });
    const occurrences = r.diagnostics.filter((d) => d.code === 'JOURNAL_WHEN_NOT_INCREASING');
    expect(occurrences).toHaveLength(1);
  });
});

describe('evaluateIdentity — incremental login', () => {
  const pending = journal.slice(22);
  const cfg: ExecutionConfig = { requestedMode: 'incremental', expectedDatabase: 'app' };
  const run = (facts: IdentityFacts, config: ExecutionConfig = cfg) => evaluateIdentity('incremental', facts, config, pending).map((d) => d.code);

  it('accepts the expected identity', () => {
    expect(run(incrementalFacts())).toEqual([]);
  });

  it.each<[string, Partial<IdentityFacts>, DiagnosticCode]>([
    ['session user is a superuser', { sessionIsSuperuser: true }, 'IDENTITY_SESSION_SUPERUSER'],
    ['session user has BYPASSRLS', { sessionBypassRls: true }, 'IDENTITY_SESSION_BYPASSRLS'],
    ['session user has CREATEROLE', { sessionCreateRole: true }, 'IDENTITY_SESSION_CREATEROLE'],
    ['app_migrator does not exist', { appMigratorRoleExists: false }, 'IDENTITY_APP_MIGRATOR_ROLE_MISSING'],
    ['no SET membership in app_migrator', { sessionHasSetMembership: false }, 'IDENTITY_NO_SET_MEMBERSHIP'],
    ['app_migrator lacks CREATE on the database', { appMigratorHasDatabaseCreate: false }, 'IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE'],
    ['current_user is not app_migrator (SET ROLE not done)', { currentUser: 'migrator_inc' }, 'IDENTITY_CURRENT_USER_UNEXPECTED'],
    ['effective role is a superuser', { currentIsSuperuser: true }, 'IDENTITY_CURRENT_USER_PRIVILEGED'],
    ['effective role has BYPASSRLS', { currentBypassRls: true }, 'IDENTITY_CURRENT_USER_PRIVILEGED'],
    ['connected to another database', { database: 'other' }, 'CONFIG_DATABASE_MISMATCH'],
  ])('refuses when %s', (_name, over, code) => {
    expect(run(incrementalFacts(over))).toContain(code);
  });

  it('refuses when the login is not the configured incremental login', () => {
    expect(run(incrementalFacts(), { ...cfg, incrementalLogin: 'someone_else' })).toContain('IDENTITY_SESSION_USER_MISMATCH');
  });

  it('refuses when the bootstrap and incremental logins are the same account', () => {
    expect(run(incrementalFacts(), { ...cfg, bootstrapLogin: 'same', incrementalLogin: 'same', requestedMode: 'incremental' })).toContain('CONFIG_LOGINS_NOT_SEPARATED');
  });

  it('does not require membership checks when the role is missing (one clear finding instead)', () => {
    const r = run(incrementalFacts({ appMigratorRoleExists: false, sessionHasSetMembership: false, appMigratorHasDatabaseCreate: false, currentUser: 'migrator_inc' }));
    expect(r).toContain('IDENTITY_APP_MIGRATOR_ROLE_MISSING');
    expect(r).not.toContain('IDENTITY_NO_SET_MEMBERSHIP');
  });
});

describe('evaluateIdentity — bootstrap login', () => {
  it('requires a superuser', () => {
    const codes = evaluateIdentity('bootstrap', bootstrapFacts({ sessionIsSuperuser: false }), { requestedMode: 'bootstrap', expectedDatabase: 'app' }, journal).map((d) => d.code);
    expect(codes).toContain('IDENTITY_BOOTSTRAP_NOT_SUPERUSER');
  });

  it('on a batch that starts with 0000, current_user must still be the login (not app_migrator)', () => {
    const codes = evaluateIdentity('bootstrap', bootstrapFacts({ currentUser: 'app_migrator' }), { requestedMode: 'bootstrap', expectedDatabase: 'app' }, journal).map((d) => d.code);
    expect(codes).toContain('IDENTITY_CURRENT_USER_UNEXPECTED');
  });

  it('when 0000 is not pending, the effective app_migrator must still be subject to RLS', () => {
    const pendingWithout0000 = journal.slice(19, 20);
    const run = (over: Partial<IdentityFacts>) =>
      evaluateIdentity('bootstrap', bootstrapFacts({ currentUser: 'app_migrator', ...over }), { requestedMode: 'bootstrap', expectedDatabase: 'app' }, pendingWithout0000).map((d) => d.code);
    expect(run({ currentIsSuperuser: false, currentBypassRls: false })).toEqual([]);
    expect(run({ currentIsSuperuser: true, currentBypassRls: false })).toContain('IDENTITY_CURRENT_USER_PRIVILEGED');
    expect(run({ currentIsSuperuser: false, currentBypassRls: true })).toContain('IDENTITY_CURRENT_USER_PRIVILEGED');
  });

  it('when 0000 is pending, the login itself is legitimately privileged and is not flagged', () => {
    const codes = evaluateIdentity('bootstrap', bootstrapFacts(), { requestedMode: 'bootstrap', expectedDatabase: 'app' }, journal).map((d) => d.code);
    expect(codes).not.toContain('IDENTITY_CURRENT_USER_PRIVILEGED');
  });
});

describe('expectedStartingRole', () => {
  it('is the session user only when migration 0 is pending', () => {
    expect(expectedStartingRole(journal)).toBe('session_user');
    expect(expectedStartingRole(journal.slice(1))).toBe('app_migrator');
    expect(expectedStartingRole([])).toBe('app_migrator');
  });
});

describe('formatDiagnostics', () => {
  it('prints one line per finding with the code and the migration, nothing else', () => {
    const text = formatDiagnostics(assessExecution(input({ applied: 10 })).diagnostics);
    expect(text).toContain('[PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE]');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
  });
});

describe('database-level CREATE is required whenever migrations will run as app_migrator (D-8A)', () => {
  const existing = bootstrapFacts({ appMigratorRoleExists: true, currentUser: 'app_migrator', currentIsSuperuser: false, currentBypassRls: false });
  const config = { requestedMode: 'bootstrap', expectedDatabase: 'app' } as const;
  const pending0019 = journal.slice(19, 20);

  it('bootstrap mode on an existing database that was never provisioned is refused up front, with the remedy', () => {
    const d = evaluateIdentity('bootstrap', existing, config, pending0019);
    expect(d.map((x) => x.code)).toEqual(['IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE']);
    expect(d[0]?.message).toContain('--mode bootstrap --provision-only');
    expect(d[0]?.message).toContain('CREATE DATABASE … TEMPLATE');
  });

  it('is satisfied once the database was provisioned', () => {
    expect(evaluateIdentity('bootstrap', { ...existing, appMigratorHasDatabaseCreate: true }, config, pending0019)).toEqual([]);
  });

  it('does not apply to --provision-only (it runs no migration, and is how the privilege gets there)', () => {
    expect(evaluateIdentity('bootstrap', existing, { ...config, willRunMigrations: false }, pending0019)).toEqual([]);
  });

  it('does not apply to a batch that starts with 0000 (the role does not exist yet) or when nothing is pending', () => {
    expect(evaluateIdentity('bootstrap', bootstrapFacts(), config, journal)).toEqual([]);
    expect(evaluateIdentity('bootstrap', existing, config, [])).toEqual([]);
  });
});
