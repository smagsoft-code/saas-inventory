import { beforeAll, describe, expect, it } from 'vitest';
import { lintMigration, type LintFinding } from './lint-migration';
import { exitCodeFor, formatFinding, lowCertaintyCount, summary } from './report';
import type { MigrationContext } from './rules';
import { loadSqlParser, type SqlParser } from './sql-parser';

/**
 * The PL/pgSQL policy (ADR-0041, D-8D.1-C), pinned down case by case.
 *
 * The parser (libpg-query, PostgreSQL 16 grammar) has NO PL/pgSQL parser. The body of a DO block and of a LANGUAGE plpgsql
 * function is an opaque string to it. The policy:
 *   - ordinary migration with PL/pgSQL it cannot read → ERROR (the batch is refused);
 *   - migration declared privileged                    → WARNING (needs the explicit review that "privileged" implies);
 *   - never "validated", never clean; certainty is `low` (NOT confirmed by the syntax tree), unlike every AST-based finding;
 *   - "privileged" excuses nothing else: the critical rules keep blocking in the same file.
 * These tests never assume the inside of a body was analysed — several assert, on the contrary, that what is inside is invisible.
 */

let parser: SqlParser;
beforeAll(async () => {
  parser = await loadSqlParser();
});
const lint = (sql: string, context: MigrationContext): LintFinding[] => lintMigration(parser, sql, { tag: '0099_policy', context });
const unanalysed = (sql: string, context: MigrationContext) => lint(sql, context).filter((f) => f.ruleId === 'PLPGSQL-UNANALYZED');

const DO_PLAIN = "DO $$ BEGIN PERFORM 1; END $$;";
const DO_DYNAMIC = "DO $$ BEGIN EXECUTE format('CREATE TABLE %I (id int)', 'dyn_t'); END $$;";
const FN_PLAIN = 'CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;';
const FN_DYNAMIC = "CREATE FUNCTION run_it() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'GRANT SELECT ON t TO PUBLIC'; END $$;";
const PROC = 'CREATE PROCEDURE p() LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;';

describe('the policy matrix: unanalysed PL/pgSQL is ERROR in an ordinary migration and WARNING in a privileged one', () => {
  it.each([
    ['a DO block', DO_PLAIN],
    ['a DO block with dynamic SQL', DO_DYNAMIC],
    ['a PL/pgSQL function', FN_PLAIN],
    ['a PL/pgSQL function with dynamic SQL', FN_DYNAMIC],
    ['a PL/pgSQL procedure', PROC],
  ])('%s', (_name, sql) => {
    const ordinary = unanalysed(sql, 'ordinary');
    const privileged = unanalysed(sql, 'privileged');
    expect(ordinary).toHaveLength(1);
    expect(privileged).toHaveLength(1);
    expect(ordinary[0]?.severity).toBe('ERROR');
    expect(privileged[0]?.severity).toBe('WARNING');
    expect(exitCodeFor(lint(sql, 'ordinary'))).toBe(1); // an ordinary migration with it is refused
    expect(exitCodeFor(lint(sql, 'privileged'))).toBe(0); // a privileged one is not blocked by it…
    expect(exitCodeFor(lint(sql, 'privileged'), true)).toBe(1); // …but it is never clean: --strict still stops it
  });
});

describe('certainty: what the syntax tree did not confirm is marked as such', () => {
  it('unanalysed PL/pgSQL is low certainty, an AST-based finding is high', () => {
    expect(unanalysed(DO_DYNAMIC, 'ordinary').every((f) => f.certainty === 'low')).toBe(true);
    const confirmed = lint('GRANT SELECT ON t TO PUBLIC;', 'ordinary');
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed.every((f) => f.certainty === 'high')).toBe(true);
  });

  it('a SQL-language function body IS parsed (high certainty) while a PL/pgSQL one is not (low)', () => {
    const sqlFn = lint('CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ GRANT SELECT ON t TO PUBLIC $$;', 'ordinary');
    expect(sqlFn.find((f) => f.ruleId === 'PRIV-GRANT-PUBLIC')?.certainty).toBe('high');
    expect(sqlFn.some((f) => f.ruleId === 'PLPGSQL-UNANALYZED')).toBe(false);
    expect(unanalysed(FN_PLAIN, 'ordinary')[0]?.certainty).toBe('low');
  });

  it('the report counts them apart and the line says they are not confirmed', () => {
    const findings = [...lint(DO_PLAIN, 'privileged'), ...lint('GRANT SELECT ON t TO app_tenant;', 'privileged')];
    expect(lowCertaintyCount(findings)).toBe(1);
    expect(summary(findings)).toContain('1 of low certainty (not confirmed by the syntax tree');
    const line = formatFinding(findings.find((f) => f.ruleId === 'PLPGSQL-UNANALYZED') as LintFinding);
    expect(line).toContain('NOT confirmed by the syntax tree');
    expect(formatFinding(findings.find((f) => f.ruleId === 'PRIV-GRANT') as LintFinding)).not.toContain('NOT confirmed');
  });
});

describe('the finding never claims the body was checked, and dynamic SQL is named as an unanalysed risk', () => {
  it.each([DO_PLAIN, FN_PLAIN, DO_DYNAMIC, FN_DYNAMIC])('says what is NOT checked: %s', (sql) => {
    const message = unanalysed(sql, 'ordinary')[0]?.message ?? '';
    expect(message).toContain('cannot look into');
    expect(message).toContain('dynamic SQL, privileged statements and RLS changes inside it are NOT checked');
    expect(message).not.toMatch(/\b(validated|analysed successfully|safe)\b/i);
  });

  it('a body with EXECUTE gets a lexical hint, labelled as not a parse; a body without it gets none', () => {
    const dynamic = unanalysed(DO_DYNAMIC, 'ordinary')[0]?.message ?? '';
    expect(dynamic).toContain('Lexical hint only (not parsed');
    expect(dynamic).toContain('EXECUTE');
    expect(unanalysed(FN_DYNAMIC, 'ordinary')[0]?.message).toMatch(/Lexical hint only.*EXECUTE.*GRANT/s);
    expect(unanalysed(DO_PLAIN, 'ordinary')[0]?.message).not.toContain('Lexical hint');
  });

  it('what is inside the body is invisible: a role, a grant and an RLS change hidden in it produce no finding of their own', () => {
    const hidden = "DO $$ BEGIN CREATE ROLE sneaky; GRANT ALL ON t TO PUBLIC; ALTER TABLE t DISABLE ROW LEVEL SECURITY; END $$;";
    for (const context of ['ordinary', 'privileged'] as const) {
      expect(lint(hidden, context).map((f) => f.ruleId)).toEqual(['PLPGSQL-UNANALYZED']);
    }
  });
});

describe('"privileged" is not an authorisation for anything else', () => {
  it.each([
    ['a PUBLIC grant', 'GRANT SELECT ON t TO PUBLIC;', 'PRIV-GRANT-PUBLIC'],
    ['DISABLE ROW LEVEL SECURITY', 'ALTER TABLE t DISABLE ROW LEVEL SECURITY;', 'RLS-DISABLE'],
    ['REASSIGN OWNED', 'REASSIGN OWNED BY a TO b;', 'PRIV-REASSIGN'],
    ['CREATE DATABASE', 'CREATE DATABASE d;', 'ADMIN-DATABASE'],
    ['COPY … PROGRAM', "COPY t FROM PROGRAM 'ls';", 'ADMIN-FILE-ACCESS'],
    ['SECURITY DEFINER', 'CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;', 'FUNC-SECURITY-DEFINER'],
    ['transaction control', 'COMMIT;', 'TXN-CONTROL'],
    ['SQL that does not parse', 'CREATE TABEL t ();', 'LINT-PARSE-ERROR'],
  ])('%s still blocks in a privileged migration, next to a DO block that only warns', (_name, sql, ruleId) => {
    const findings = lint(`${DO_PLAIN}\n--> statement-breakpoint\n${sql}`, 'privileged');
    expect(findings.find((f) => f.ruleId === ruleId)?.severity).toBe('ERROR');
    expect(findings.find((f) => f.ruleId === 'PLPGSQL-UNANALYZED')?.severity).toBe('WARNING');
    expect(exitCodeFor(findings)).toBe(1);
  });
});

describe('known limitation: comments inside an opaque body can trigger the lexical hint', () => {
  it('a comment that mentions GRANT makes the hint say so — the hint is lexical and the limitation is documented, not hidden', () => {
    const innocent = 'DO $$ BEGIN -- no GRANT here, only this comment\n PERFORM 1; END $$;';
    const message = unanalysed(innocent, 'ordinary')[0]?.message ?? '';
    expect(message).toContain('a comment or a string can trigger it');
    expect(message).toContain('GRANT'); // a false positive of the HINT only; the finding itself is unchanged and correct
    expect(unanalysed(innocent, 'ordinary')[0]?.severity).toBe('ERROR');
  });
});
