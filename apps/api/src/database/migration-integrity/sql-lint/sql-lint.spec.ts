import { beforeAll, describe, expect, it } from 'vitest';
import { applyExceptions, type LintException } from './exceptions';
import { lintMigration, type LintFinding } from './lint-migration';
import { countBySeverity, exitCodeFor, formatFinding, formatTable, isOpen, summary } from './report';
import { RULES, RULE_IDS, severityOf, type MigrationContext } from './rules';
import { loadSqlParser, type SqlParser } from './sql-parser';

/**
 * Unit tests of the SQL/RLS linter. They use the REAL PostgreSQL 16 parser (WebAssembly, in process): no database, no
 * connection, no files. Each rule has a positive case, a negative case and, where the syntax allows, a boundary.
 */

let parser: SqlParser;
beforeAll(async () => {
  parser = await loadSqlParser();
});

const lint = (sql: string, context: MigrationContext = 'ordinary', tag = '0099_test'): LintFinding[] => lintMigration(parser, sql, { tag, context });
const pairs = (sql: string, context: MigrationContext = 'ordinary') => lint(sql, context).map((f) => `${f.severity}:${f.ruleId}`);
const has = (sql: string, expected: string, context: MigrationContext = 'ordinary') => expect(pairs(sql, context)).toContain(expected);
const hasNot = (sql: string, ruleId: string, context: MigrationContext = 'ordinary') => expect(lint(sql, context).map((f) => f.ruleId)).not.toContain(ruleId);

describe('the rule catalogue', () => {
  it('has unique, stable identifiers and an explicit severity for both contexts', () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const id of RULE_IDS) {
      const info = RULES[id];
      expect(info?.id).toBe(id);
      expect(['ERROR', 'WARNING', 'INFO']).toContain(severityOf(id, 'ordinary'));
      expect(['ERROR', 'WARNING', 'INFO']).toContain(severityOf(id, 'privileged'));
    }
    expect(() => severityOf('NOPE', 'ordinary')).toThrow();
  });

  it('rules that make a file unanalysable or break the batch transaction cannot be excepted', () => {
    for (const id of ['LINT-PARSE-ERROR', 'LINT-INTERNAL', 'TXN-CONTROL']) expect(RULES[id]?.exceptable).toBe(false);
  });
});

describe('A. privileges, roles and ownership', () => {
  it.each([
    ['GRANT SELECT, UPDATE (a) ON t TO app_tenant;', 'WARNING:PRIV-GRANT'],
    ['GRANT USAGE ON SCHEMA public TO app_tenant;', 'WARNING:PRIV-GRANT'],
    ['GRANT SELECT ON "my table" TO "app_tenant";', 'WARNING:PRIV-GRANT'],
    ['GRANT SELECT ON t TO PUBLIC;', 'ERROR:PRIV-GRANT-PUBLIC'],
    ['GRANT SELECT ON t TO app_tenant WITH GRANT OPTION;', 'ERROR:PRIV-GRANT-PUBLIC'],
    ['GRANT SELECT ON t TO some_other_role;', 'ERROR:PRIV-GRANT-PUBLIC'],
    ['GRANT SELECT ON t TO session_user;', 'ERROR:PRIV-GRANT-PUBLIC'],
    ['GRANT ALL ON t TO app_tenant;', 'ERROR:PRIV-GRANT-BROAD'],
    ['GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_tenant;', 'ERROR:PRIV-GRANT-BROAD'],
    ['REVOKE ALL ON t FROM app_tenant;', 'WARNING:PRIV-REVOKE'],
    ['GRANT app_migrator TO bob;', 'ERROR:PRIV-ROLE-MEMBERSHIP'],
    ['REVOKE app_migrator FROM bob;', 'ERROR:PRIV-ROLE-MEMBERSHIP'],
    ['ALTER SCHEMA public OWNER TO app_migrator;', 'ERROR:PRIV-OWNER-CHANGE'],
    ['ALTER TABLE t OWNER TO bob;', 'ERROR:PRIV-OWNER-CHANGE'],
    ['ALTER FUNCTION f() OWNER TO bob;', 'ERROR:PRIV-OWNER-CHANGE'],
    ['ALTER SEQUENCE s OWNER TO bob;', 'ERROR:PRIV-OWNER-CHANGE'],
    ['CREATE SCHEMA s AUTHORIZATION bob;', 'ERROR:PRIV-OWNER-CHANGE'],
    ['REASSIGN OWNED BY a TO b;', 'ERROR:PRIV-REASSIGN'],
    ['DROP OWNED BY a;', 'ERROR:PRIV-REASSIGN'],
    ['ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_tenant;', 'ERROR:PRIV-DEFAULT-PRIVILEGES'],
    ['CREATE ROLE r;', 'ERROR:ROLE-DDL'],
    ['ALTER ROLE r WITH LOGIN;', 'ERROR:ROLE-DDL'],
    ['DROP ROLE r;', 'ERROR:ROLE-DDL'],
    ['ALTER ROLE r SET work_mem = 1;', 'ERROR:ROLE-DDL'],
    ['CREATE ROLE r WITH SUPERUSER;', 'ERROR:ROLE-ATTRIBUTES'],
    ['CREATE ROLE r WITH BYPASSRLS;', 'ERROR:ROLE-ATTRIBUTES'],
    ['ALTER ROLE r WITH CREATEROLE;', 'ERROR:ROLE-ATTRIBUTES'],
    ['SET ROLE app_migrator;', 'ERROR:SESSION-IDENTITY'],
    ['SET LOCAL ROLE app_migrator;', 'ERROR:SESSION-IDENTITY'],
    ['RESET ROLE;', 'ERROR:SESSION-IDENTITY'],
    ['SET SESSION AUTHORIZATION bob;', 'ERROR:SESSION-IDENTITY'],
    ['RESET ALL;', 'ERROR:SESSION-IDENTITY'],
  ])('ordinary: %s → %s', (sql, expected) => has(sql, expected));

  it('the same statements are expected, not forbidden, in a migration declared privileged', () => {
    expect(pairs('CREATE ROLE r;', 'privileged')).toContain('INFO:ROLE-DDL');
    expect(pairs('CREATE ROLE r WITH BYPASSRLS;', 'privileged')).toEqual(expect.arrayContaining(['INFO:ROLE-DDL', 'WARNING:ROLE-ATTRIBUTES']));
    expect(pairs('GRANT app_migrator TO bob;', 'privileged')).toContain('INFO:PRIV-ROLE-MEMBERSHIP');
    expect(pairs('ALTER SCHEMA public OWNER TO app_migrator;', 'privileged')).toContain('INFO:PRIV-OWNER-CHANGE');
    expect(pairs('SET ROLE app_migrator;', 'privileged')).toContain('INFO:SESSION-IDENTITY');
    expect(pairs('GRANT ALL ON SCHEMA drizzle TO app_migrator;', 'privileged')).toContain('WARNING:PRIV-GRANT-BROAD');
  });

  it('but being privileged does not excuse PUBLIC grants, REASSIGN OWNED, or anything that reaches outside the database', () => {
    expect(pairs('GRANT SELECT ON t TO PUBLIC;', 'privileged')).toContain('ERROR:PRIV-GRANT-PUBLIC');
    expect(pairs('REASSIGN OWNED BY a TO b;', 'privileged')).toContain('ERROR:PRIV-REASSIGN');
    expect(pairs('CREATE DATABASE d;', 'privileged')).toContain('ERROR:ADMIN-DATABASE');
    expect(pairs("COPY t FROM PROGRAM 'ls';", 'privileged')).toContain('ERROR:ADMIN-FILE-ACCESS');
  });

  it('negative: ordinary statements raise none of these', () => {
    for (const sql of ['CREATE TABLE t (id int);', 'SET search_path = public;', 'SET LOCAL lock_timeout = 1000;', 'SELECT 1;', 'INSERT INTO a SELECT * FROM b;', 'CREATE INDEX i ON t (id);']) {
      expect(lint(sql).filter((f) => f.severity !== 'INFO')).toEqual([]);
    }
  });
});

describe('administrative and server-level operations', () => {
  it.each([
    ['CREATE DATABASE d;', 'ADMIN-DATABASE'],
    ['DROP DATABASE d;', 'ADMIN-DATABASE'],
    ['ALTER DATABASE d SET x = 1;', 'ADMIN-DATABASE'],
    ["ALTER SYSTEM SET work_mem = '1MB';", 'ADMIN-DATABASE'],
    ["LOAD 'x';", 'ADMIN-DATABASE'],
    ['CREATE EXTENSION pgcrypto;', 'ADMIN-EXTENSION'],
    ['DROP EXTENSION pgcrypto;', 'ADMIN-EXTENSION'],
    ['CREATE SERVER s FOREIGN DATA WRAPPER w;', 'ADMIN-REMOTE'],
    ['CREATE EVENT TRIGGER e ON ddl_command_start EXECUTE FUNCTION f();', 'ADMIN-REMOTE'],
    ["COPY t FROM PROGRAM 'ls';", 'ADMIN-FILE-ACCESS'],
    ["COPY t TO '/tmp/x';", 'ADMIN-FILE-ACCESS'],
    ["SELECT pg_read_file('/etc/passwd');", 'FUNC-SERVER-ACCESS'],
    ["SELECT lo_import('/x');", 'FUNC-SERVER-ACCESS'],
    ["SELECT dblink_exec('x', 'y');", 'FUNC-SERVER-ACCESS'],
    ['SELECT pg_advisory_lock(1);', 'ADVISORY-LOCK'],
  ])('%s → %s', (sql, id) => {
    expect(lint(sql).map((f) => f.ruleId)).toContain(id);
  });

  it('COPY from STDIN is not file access', () => hasNot('COPY t FROM STDIN;', 'ADMIN-FILE-ACCESS'));
  it('CREATE EXTENSION is expected (INFO) in a privileged migration', () => expect(pairs('CREATE EXTENSION IF NOT EXISTS pgcrypto;', 'privileged')).toContain('INFO:ADMIN-EXTENSION'));

  it('transaction control breaks the one-transaction batch (ERROR, never excepted); savepoints are only a warning', () => {
    for (const sql of ['BEGIN;', 'COMMIT;', 'ROLLBACK;', "PREPARE TRANSACTION 'x';", 'START TRANSACTION;']) {
      expect(pairs(sql)).toContain('ERROR:TXN-CONTROL');
      expect(pairs(sql, 'privileged')).toContain('ERROR:TXN-CONTROL');
    }
    expect(pairs('SAVEPOINT s;')).toContain('WARNING:TXN-SAVEPOINT');
  });
});

describe('B. row-level security and tenant isolation', () => {
  it('DISABLE ROW LEVEL SECURITY is an error, ordinary or privileged', () => {
    has('ALTER TABLE t DISABLE ROW LEVEL SECURITY;', 'ERROR:RLS-DISABLE');
    has('ALTER TABLE t DISABLE ROW LEVEL SECURITY;', 'ERROR:RLS-DISABLE', 'privileged');
    has('ALTER TABLE t ENABLE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;', 'ERROR:RLS-DISABLE');
  });

  it('ENABLE without FORCE in the same file is an error; ENABLE + FORCE (any order, one or two statements) is not', () => {
    has('ALTER TABLE t ENABLE ROW LEVEL SECURITY;', 'ERROR:RLS-ENABLE-WITHOUT-FORCE');
    hasNot('ALTER TABLE t ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE t FORCE ROW LEVEL SECURITY;', 'RLS-ENABLE-WITHOUT-FORCE');
    hasNot('ALTER TABLE t FORCE ROW LEVEL SECURITY, ENABLE ROW LEVEL SECURITY;', 'RLS-ENABLE-WITHOUT-FORCE');
    has('ALTER TABLE a ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE b FORCE ROW LEVEL SECURITY;', 'ERROR:RLS-ENABLE-WITHOUT-FORCE'); // a different table does not count
  });

  it('a NO FORCE window restored by FORCE is a WARNING with its contract; never restored is an ERROR', () => {
    const window = 'ALTER TABLE t NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint\nUPDATE t SET a = 1;--> statement-breakpoint\nALTER TABLE t FORCE ROW LEVEL SECURITY;';
    expect(pairs(window)).toEqual(expect.arrayContaining(['WARNING:RLS-WINDOW', 'WARNING:RLS-WINDOW-UNGUARDED']));
    expect(pairs(window)).not.toContain('ERROR:RLS-WINDOW-UNRESTORED');
    has('ALTER TABLE t NO FORCE ROW LEVEL SECURITY;', 'ERROR:RLS-WINDOW-UNRESTORED');
    has('ALTER TABLE t FORCE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE t NO FORCE ROW LEVEL SECURITY;', 'ERROR:RLS-WINDOW-UNRESTORED'); // FORCE came first
    has('ALTER TABLE a NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE b FORCE ROW LEVEL SECURITY;', 'ERROR:RLS-WINDOW-UNRESTORED'); // the wrong table
  });

  it('a window whose verification is visible (row_security_active / relforcerowsecurity) is not flagged as unguarded', () => {
    const guarded =
      "ALTER TABLE t NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint\nSELECT CASE WHEN row_security_active('t'::regclass) THEN 1/0 END;--> statement-breakpoint\nALTER TABLE t FORCE ROW LEVEL SECURITY;";
    expect(pairs(guarded)).toContain('WARNING:RLS-WINDOW');
    hasNot(guarded, 'RLS-WINDOW-UNGUARDED');
    const viaCatalog = "ALTER TABLE t NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint\nSELECT relforcerowsecurity FROM pg_class;--> statement-breakpoint\nALTER TABLE t FORCE ROW LEVEL SECURITY;";
    hasNot(viaCatalog, 'RLS-WINDOW-UNGUARDED');
  });

  it('policies: creation is INFO; PUBLIC (explicit or implicit) is an error; a constant-true filter is a warning; ALTER/DROP are warnings', () => {
    expect(pairs('CREATE POLICY p ON t FOR ALL TO app_tenant USING (tenant_id = 1);')).toEqual(['INFO:RLS-POLICY-CREATE']);
    has('CREATE POLICY p ON t USING (tenant_id = 1);', 'ERROR:RLS-POLICY-PUBLIC');
    has('CREATE POLICY p ON t TO PUBLIC USING (tenant_id = 1);', 'ERROR:RLS-POLICY-PUBLIC');
    has('ALTER POLICY p ON t TO PUBLIC;', 'ERROR:RLS-POLICY-PUBLIC');
    has('CREATE POLICY p ON t TO app_event_processor USING (true) WITH CHECK (true);', 'WARNING:RLS-POLICY-ALWAYS-TRUE');
    expect(lint('CREATE POLICY p ON t TO app_event_processor USING (true) WITH CHECK (true);').filter((f) => f.ruleId === 'RLS-POLICY-ALWAYS-TRUE')).toHaveLength(2);
    hasNot('CREATE POLICY p ON t TO app_tenant USING (deleted_at IS NULL);', 'RLS-POLICY-ALWAYS-TRUE');
    has('ALTER POLICY p ON t USING (tenant_id = 2);', 'WARNING:RLS-POLICY-CHANGE');
    has('DROP POLICY p ON t;', 'WARNING:RLS-POLICY-CHANGE');
  });

  it.each([
    ['SET row_security = off;', 'RLS-SETTING'],
    ['SET LOCAL row_security TO off;', 'RLS-SETTING'],
    ["SET session_replication_role = 'replica';", 'RLS-SETTING'],
    ["SELECT set_config('row_security', 'off', false);", 'RLS-SETTING'],
    ["SELECT set_config('session_replication_role', 'replica', true);", 'RLS-SETTING'],
    ['ALTER ROLE r SET row_security = off;', 'RLS-SETTING'],
  ])('%s → %s', (sql, id) => has(sql, `ERROR:${id}`));

  it('other settings are not RLS settings', () => {
    hasNot("SELECT set_config('statement_timeout', '5s', false);", 'RLS-SETTING');
    hasNot('SET statement_timeout = 5000;', 'RLS-SETTING');
  });

  it('triggers: disable+enable is a warning window, unpaired is an error, a tenant-isolation trigger is always an error', () => {
    const paired = 'ALTER TABLE t DISABLE TRIGGER set_updated_at;--> statement-breakpoint\nUPDATE t SET a = 1;--> statement-breakpoint\nALTER TABLE t ENABLE TRIGGER set_updated_at;';
    expect(pairs(paired)).toContain('WARNING:TRIGGER-DISABLE-WINDOW');
    has('ALTER TABLE t DISABLE TRIGGER set_updated_at;', 'ERROR:TRIGGER-DISABLED-UNRESTORED');
    has('ALTER TABLE t DISABLE TRIGGER ALL;--> statement-breakpoint\nALTER TABLE t ENABLE TRIGGER ALL;', 'WARNING:TRIGGER-DISABLE-WINDOW');
    has('ALTER TABLE t DISABLE TRIGGER prevent_tenant_id_change;--> statement-breakpoint\nALTER TABLE t ENABLE TRIGGER prevent_tenant_id_change;', 'ERROR:TRIGGER-PROTECTED');
    has('DROP TRIGGER prevent_tenant_id_change ON t;', 'ERROR:TRIGGER-PROTECTED');
    has('DROP TRIGGER set_updated_at ON t;', 'WARNING:TRIGGER-DROP');
    expect(pairs('CREATE TRIGGER tr BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f();')).toEqual([]);
  });

  it('the tenant_id column cannot be dropped, renamed, retyped or made nullable; other columns can', () => {
    has('ALTER TABLE t DROP COLUMN tenant_id;', 'ERROR:TENANT-COLUMN');
    has('ALTER TABLE t ALTER COLUMN tenant_id DROP NOT NULL;', 'ERROR:TENANT-COLUMN');
    has('ALTER TABLE t ALTER COLUMN tenant_id TYPE text;', 'ERROR:TENANT-COLUMN');
    has('ALTER TABLE t RENAME COLUMN tenant_id TO x;', 'ERROR:TENANT-COLUMN');
    hasNot('ALTER TABLE t DROP COLUMN other;', 'TENANT-COLUMN');
    hasNot('ALTER TABLE t ADD COLUMN tenant_id uuid NOT NULL;', 'TENANT-COLUMN');
  });
});

describe('C. functions, DO blocks and dynamic SQL', () => {
  it('SECURITY DEFINER is an error on CREATE and on ALTER FUNCTION', () => {
    has('CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;', 'ERROR:FUNC-SECURITY-DEFINER');
    has('ALTER FUNCTION f() SECURITY DEFINER;', 'ERROR:FUNC-SECURITY-DEFINER');
    hasNot('CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY INVOKER AS $$ SELECT 1 $$;', 'FUNC-SECURITY-DEFINER');
  });

  it('a SQL-language function body IS parsed and its statements are linted', () => {
    const f = lint('CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ GRANT SELECT ON t TO PUBLIC $$;');
    expect(f.map((x) => x.ruleId)).toContain('PRIV-GRANT-PUBLIC');
    expect(f.find((x) => x.ruleId === 'PRIV-GRANT-PUBLIC')?.operation).toContain('function body');
    has('CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELEC 1 $$;', 'ERROR:LINT-PARSE-ERROR');
    expect(lint('CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;').filter((x) => x.severity !== 'INFO')).toEqual([]);
  });

  it('PL/pgSQL (function bodies and DO blocks) cannot be analysed: ERROR in an ordinary migration, WARNING if declared privileged, always low certainty', () => {
    const fn = "CREATE FUNCTION g() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;";
    const doBlock = "DO $$ BEGIN EXECUTE format('GRANT app_migrator TO %I', session_user); END $$;";
    for (const sql of [fn, doBlock]) {
      expect(pairs(sql)).toContain('ERROR:PLPGSQL-UNANALYZED');
      expect(pairs(sql, 'privileged')).toContain('WARNING:PLPGSQL-UNANALYZED');
      expect(lint(sql).find((f) => f.ruleId === 'PLPGSQL-UNANALYZED')?.certainty).toBe('low');
    }
    // a lexical hint helps triage but is explicitly not a parse
    const message = lint(doBlock).find((f) => f.ruleId === 'PLPGSQL-UNANALYZED')?.message ?? '';
    expect(message).toContain('Lexical hint only');
    expect(message).toContain('EXECUTE');
    expect(message).toContain('GRANT');
    expect(lint(fn).find((f) => f.ruleId === 'PLPGSQL-UNANALYZED')?.message).not.toContain('Lexical hint');
  });

  it('a sensitive statement hidden in a DO block is NOT reported as such (the limit, stated, not hidden)', () => {
    const f = lint('DO $$ BEGIN CREATE ROLE hidden; END $$;', 'privileged');
    expect(f.map((x) => x.ruleId)).toEqual(['PLPGSQL-UNANALYZED']);
    expect(f.every((x) => x.certainty === 'low')).toBe(true);
  });

  it('untrusted languages are an error', () => {
    has("CREATE FUNCTION f() RETURNS int LANGUAGE c AS 'x', 'y';", 'ERROR:FUNC-UNTRUSTED-LANGUAGE');
    has("DO LANGUAGE plpython3u $$ pass $$;", 'ERROR:FUNC-UNTRUSTED-LANGUAGE');
  });

  it('EXECUTE of a prepared statement, PREPARE and CALL are flagged (the parser cannot see through them)', () => {
    has('PREPARE p AS SELECT 1;', 'WARNING:DYN-EXECUTE');
    has('EXECUTE p;', 'WARNING:DYN-EXECUTE');
    has('CALL proc();', 'WARNING:DYN-EXECUTE');
  });
});

describe('D. data-destroying operations', () => {
  it('TRUNCATE and DROP TABLE / SCHEMA are warnings; DROP INDEX is not', () => {
    has('TRUNCATE a, b;', 'WARNING:DATA-TRUNCATE');
    has('DROP TABLE a;', 'WARNING:DATA-DROP');
    has('DROP SCHEMA s CASCADE;', 'WARNING:DATA-DROP');
    hasNot('DROP INDEX i;', 'DATA-DROP');
  });
});

describe('lexical boundaries: only the syntax tree decides', () => {
  it.each([
    ['a line comment', '-- GRANT ALL ON t TO PUBLIC;\nSELECT 1;'],
    ['a block comment', '/* DROP ROLE x; ALTER TABLE t DISABLE ROW LEVEL SECURITY; */ SELECT 1;'],
    ['a nested block comment', '/* a /* GRANT ALL ON t TO PUBLIC */ b */ SELECT 1;'],
    ['a string literal', "SELECT 'GRANT ALL ON t TO PUBLIC; DROP ROLE x';"],
    ['an escaped quote inside a string', "SELECT 'it''s GRANT ALL ON t TO PUBLIC';"],
    ['a dollar-quoted string', 'SELECT $q$ DISABLE ROW LEVEL SECURITY; SET ROLE x; $q$;'],
    ['a quoted identifier', 'CREATE TABLE "GRANT ALL ON t TO PUBLIC" (id int);'],
    ['a quoted column named like a keyword', 'CREATE TABLE t ("owner" text, "grant" text, "role" text);'],
    ['a COMMENT ON text', "COMMENT ON TABLE t IS 'DISABLE ROW LEVEL SECURITY and GRANT ALL';"],
    ['an INSERT carrying the words as data', "INSERT INTO audit (note) VALUES ('REVOKE ALL; SET ROLE postgres;');"],
    ['an object named like a statement', 'CREATE TABLE set_role (id int); CREATE INDEX reset_role_idx ON set_role (id);'],
  ])('%s raises nothing', (_name, sql) => {
    expect(lint(sql).filter((f) => f.severity !== 'INFO')).toEqual([]);
  });

  it('several statements in one chunk, and chunks split on the Drizzle marker, are all analysed, each with its own line', () => {
    const sql = [
      '-- header comment',
      'CREATE TABLE a (id int);',
      '',
      'GRANT SELECT ON a TO PUBLIC;--> statement-breakpoint',
      '/* block',
      '   comment */',
      'DROP ROLE x; SET ROLE y;',
    ].join('\n');
    const f = lint(sql).filter((x) => x.severity !== 'INFO');
    expect(f.map((x) => `${x.ruleId}@${x.line}`)).toEqual(['PRIV-GRANT-PUBLIC@4', 'ROLE-DDL@7', 'SESSION-IDENTITY@7']);
  });

  it('the marker splits exactly as Drizzle does, so a statement after it keeps its true file line', () => {
    const sql = 'SELECT 1;\n--> statement-breakpoint\n\n\nDROP ROLE r;';
    expect(lint(sql).find((f) => f.ruleId === 'ROLE-DDL')?.line).toBe(5);
  });
});

describe('fail safe: what cannot be analysed is never reported clean', () => {
  it('invalid SQL is an ERROR that cannot be excepted', () => {
    const f = lint('CREATE TABEL x ();');
    expect(f.map((x) => `${x.severity}:${x.ruleId}`)).toEqual(['ERROR:LINT-PARSE-ERROR']);
    expect(f[0]?.certainty).toBe('high');
    expect(f[0]?.line).toBe(1);
  });

  it('one bad chunk does not hide an error in the others, and reports its own line', () => {
    const f = lint('GRANT ALL ON t TO PUBLIC;--> statement-breakpoint\n\nSELEC 1;');
    expect(f.map((x) => `${x.ruleId}@${x.line}`).sort()).toEqual(['LINT-PARSE-ERROR@3', 'PRIV-GRANT-BROAD@1', 'PRIV-GRANT-PUBLIC@1']);
  });

  it.each([['an empty file', ''], ['whitespace', '  \n\t\n'], ['only comments', '-- nothing\n/* here */'], ['only markers', '--> statement-breakpoint\n--> statement-breakpoint']])(
    '%s is a warning, not "clean"',
    (_name, sql) => {
      expect(pairs(sql)).toEqual(['WARNING:LINT-EMPTY']);
    },
  );

  it('a statement kind the linter has no rule for parses and is simply not a finding (the parser, not a guess, decided it is valid SQL)', () => {
    expect(lint("CREATE TYPE mood AS ENUM ('a'); ANALYZE t;").filter((f) => f.severity !== 'INFO')).toEqual([]);
  });
});

describe('exceptions: explicit, exact, visible', () => {
  const sql = 'GRANT SELECT ON t TO PUBLIC;';
  const sha = 'a'.repeat(64);
  const hashes = { '0099_test': sha };
  const open = () => lint(sql);
  const base: LintException = {
    ruleId: 'PRIV-GRANT-PUBLIC',
    tag: '0099_test',
    sha256: sha,
    line: 1,
    reason: 'Reviewed: the public resolver view is meant to be readable by every role.',
    reviewedIn: 'review:ADR-0099:2026-10-28',
  };
  const problems = (ex: Partial<LintException>) => applyExceptions(open(), [{ ...base, ...ex }], hashes).problems.map((p) => p.message);

  it('a valid exception accepts exactly that finding, which stays in the report with its reason', () => {
    const r = applyExceptions(open(), [base], hashes);
    expect(r.problems).toEqual([]);
    const accepted = r.findings.filter((f) => f.accepted !== undefined);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.ruleId).toBe('PRIV-GRANT-PUBLIC');
    expect(accepted[0]?.message).toContain('PUBLIC'); // the statement is not hidden
    expect(accepted[0]?.accepted).toEqual({ reason: base.reason, reviewedIn: base.reviewedIn });
    expect(r.findings.filter(isOpen).filter((f) => f.severity === 'ERROR')).toEqual([]);
    expect(exitCodeFor(r.findings)).toBe(0);
    expect(summary(r.findings)).toContain('1 accepted by exception');
    expect(formatFinding(accepted[0] as LintFinding)).toContain('ACCEPTED');
  });

  it('it covers one finding, not its neighbours', () => {
    const two = lint('GRANT SELECT ON t TO PUBLIC;--> statement-breakpoint\nGRANT SELECT ON u TO PUBLIC;');
    const r = applyExceptions(two, [base], hashes);
    expect(r.findings.filter(isOpen).filter((f) => f.ruleId === 'PRIV-GRANT-PUBLIC')).toHaveLength(1);
    expect(exitCodeFor(r.findings)).toBe(1);
  });

  it.each<[string, Partial<LintException>, RegExp]>([
    ['a wildcard rule', { ruleId: 'PRIV-*' }, /wildcards are not allowed/],
    ['no rule', { ruleId: '' }, /rule id is required/],
    ['an unknown rule', { ruleId: 'NOPE' }, /unknown rule/],
    ['a rule that cannot be excepted', { ruleId: 'LINT-PARSE-ERROR' }, /cannot be excepted/],
    ['transaction control', { ruleId: 'TXN-CONTROL' }, /cannot be excepted/],
    ['a wildcard migration', { tag: '*' }, /wildcards are not allowed/],
    ['no line (a whole-file exception)', { line: 0 }, /exact line number/],
    ['a fractional line', { line: 1.5 }, /exact line number/],
    ['no hash', { sha256: '' }, /sha256 of the reviewed file/],
    ['a stale hash (the file changed)', { sha256: 'b'.repeat(64) }, /stale/],
    ['a short reason', { reason: 'ok' }, /reason of at least/],
    ['no review reference', { reviewedIn: 'trust me' }, /reviewedIn/],
    ['a migration that is not in the journal', { tag: '0098_ghost' }, /not in the journal/],
    ['the wrong line', { line: 7 }, /matches no finding/],
    ['the wrong rule for that line', { ruleId: 'PRIV-REVOKE' }, /matches no finding/],
  ])('refuses %s', (_name, patch, expected) => {
    expect(problems(patch).join('\n')).toMatch(expected);
    expect(applyExceptions(open(), [{ ...base, ...patch }], hashes).findings.some((f) => f.accepted !== undefined)).toBe(false);
  });

  it('refuses a duplicate', () => {
    expect(applyExceptions(open(), [base, base], hashes).problems.map((p) => p.message).join('\n')).toMatch(/duplicated/);
  });

  it('an exception list with no entries changes nothing', () => {
    const r = applyExceptions(open(), [], hashes);
    expect(r.findings).toEqual(open());
    expect(r.problems).toEqual([]);
  });
});

describe('reporting and exit codes', () => {
  const errorSql = 'GRANT SELECT ON t TO PUBLIC;';
  const warningSql = 'GRANT SELECT ON t TO app_tenant;';
  const infoSql = 'CREATE POLICY p ON t TO app_tenant USING (a = 1);';

  it('exit 1 when there is an ERROR; 0 when there is only a WARNING or INFO; WARNING counts only under --strict; 0 when nothing is found', () => {
    expect(exitCodeFor(lint(errorSql))).toBe(1);
    expect(exitCodeFor(lint(errorSql), true)).toBe(1);
    expect(exitCodeFor(lint(warningSql))).toBe(0);
    expect(exitCodeFor(lint(warningSql), true)).toBe(1);
    expect(exitCodeFor(lint(infoSql))).toBe(0);
    expect(exitCodeFor(lint(infoSql), true)).toBe(0);
    expect(exitCodeFor(lint('CREATE TABLE t (id int);'), true)).toBe(0);
    expect(exitCodeFor([])).toBe(0);
  });

  it('counts by severity and renders a table with file, line, rule, severity, certainty, scope and status', () => {
    const f = [...lint(errorSql), ...lint(warningSql), ...lint(infoSql)];
    expect(countBySeverity(f)).toEqual({ ERROR: 1, WARNING: 1, INFO: 1 });
    const table = formatTable(f);
    for (const header of ['file:line', 'rule', 'severity', 'certainty', 'scope', 'status', 'operation']) expect(table).toContain(header);
    expect(table).toContain('0099_test:1');
    expect(formatTable([])).toContain('file:line');
  });
});
