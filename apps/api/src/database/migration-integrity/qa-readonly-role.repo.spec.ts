import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMigrationsFolder } from './migration-files';
import { PROJECT_ROLES } from './sql-lint/rules';

/**
 * Guard for `app_qa_readonly` (migration 0051, ADR-0042). Adding the role to PROJECT_ROLES lets the SQL linter accept GRANTs to it, and the linter only
 * WARNs about a GRANT to a project role — so without this spec a later migration could give the diagnostic role INSERT, a membership or LOGIN and the
 * linter would not stop it. Reads the real migration files only (no database): the statements are examined as text, which is enough for the forms a
 * migration uses here. If a future migration legitimately needs more for this role, this spec must be changed IN THE SAME REVIEW as that migration.
 */

const ROLE = 'app_qa_readonly';
const DIR = join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations');
const folder = readMigrationsFolder(DIR);

/** Statements (split on the breakpoint marker, comments removed) of every migration, with their tag. */
const statements = folder.journal.flatMap((entry) =>
  (folder.sqlByTag[entry.tag] ?? '')
    .replace(/\r\n/g, '\n')
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((s) => s !== '')
    .map((text) => ({ tag: entry.tag, text })),
);
const mentioning = statements.filter((s) => s.text.toLowerCase().includes(ROLE));

describe('app_qa_readonly in the real migrations', () => {
  it('is a project role (so the linter knows it) and only 0051 mentions it', () => {
    expect(PROJECT_ROLES.has(ROLE)).toBe(true);
    expect([...new Set(mentioning.map((s) => s.tag))]).toEqual(['0051_qa_readonly_role']);
  });

  it('every GRANT to it is a plain SELECT on a table, column list or view: no other privilege, no WITH GRANT OPTION, no ALL', () => {
    const grants = mentioning.filter((s) => /^grant /i.test(s.text));
    expect(grants.length).toBeGreaterThan(20);
    for (const { text } of grants) {
      if (/^grant usage on schema public to /i.test(text)) continue; // the one schema grant
      const m = /^GRANT (.+?) ON (?!SCHEMA|DATABASE|FUNCTION|SEQUENCE|ALL)/i.exec(text);
      expect(m, text).not.toBeNull();
      const privileges = (m?.[1] ?? '').replace(/\([^)]*\)/g, '').trim().toUpperCase();
      expect(privileges, text).toBe('SELECT');
      expect(text, text).not.toMatch(/with grant option/i);
      expect(text, text).not.toMatch(/ ALL (TABLES|SEQUENCES|FUNCTIONS) /i);
      expect(text, text).not.toMatch(/ TO (?!app_qa_readonly;?$)/i);
    }
  });

  it('is never made a member of a role, never given members, and never given a dangerous or login attribute by a migration', () => {
    for (const { tag, text } of mentioning) {
      expect(text, `${tag}: ${text}`).not.toMatch(/^grant [a-z_]+ to app_qa_readonly/i);
      expect(text, `${tag}: ${text}`).not.toMatch(/^grant app_qa_readonly to/i);
      expect(text, `${tag}: ${text}`).not.toMatch(/^(alter|create) role app_qa_readonly\b.*\b(?<!no)(superuser|createdb|createrole|replication|bypassrls|login|inherit)\b/i);
    }
    const create = mentioning.find((s) => /create role/i.test(s.text));
    expect(create?.text).toMatch(/NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/);
  });

  it('every policy naming it is FOR SELECT, TO the role alone, and pinned to the scope view (never a session variable)', () => {
    const policies = mentioning.filter((s) => /^create policy /i.test(s.text));
    expect(policies.length).toBeGreaterThan(20);
    for (const { text } of policies) {
      expect(text, text).toMatch(/ FOR SELECT TO "app_qa_readonly" USING \(tenant_id = \(SELECT s\.tenant_id FROM qa_readonly_scope s\)\);?$/);
      expect(text, text).not.toMatch(/current_setting|set_config/i);
    }
  });

  it('no migration grants it default privileges, and nothing but 0051 changes its owner-level objects', () => {
    expect(statements.filter((s) => /alter default privileges/i.test(s.text) && s.text.toLowerCase().includes(ROLE))).toEqual([]);
    expect(statements.filter((s) => /^create view qa_readonly_/i.test(s.text)).every((s) => s.tag === '0051_qa_readonly_role')).toBe(true);
  });
});

/**
 * B4.11.3 (migration 0052): the scope is an immutable tenant UUID in a protected, EMPTY-by-default configuration table — never a slug, a name or a session variable.
 * Text-level guards only (the behaviour is proved against a real PostgreSQL by tools/pg-verify/qa-readonly-role.embedded.test.ts).
 */
const scopeStatements = statements.filter((s) => /qa_readonly_(scope|tenant)(?![a-z_])/i.test(s.text));
const config0052 = statements.filter((s) => s.tag === '0052_qa_readonly_tenant_config');

describe('qa_readonly_tenant_config in the real migrations (0052)', () => {
  it('0052 exists, is the only migration that creates or writes the configuration, and only 0051/0052 replace the scope views', () => {
    expect(config0052.length).toBeGreaterThan(3);
    const touching = scopeStatements.filter((s) => /qa_readonly_tenant_config/i.test(s.text)).map((s) => s.tag);
    expect([...new Set(touching)]).toEqual(['0052_qa_readonly_tenant_config']);
    expect([...new Set(scopeStatements.filter((s) => /^create (or replace )?view qa_readonly_/i.test(s.text)).map((s) => s.tag))]).toEqual(['0051_qa_readonly_role', '0052_qa_readonly_tenant_config']);
  });

  it('the table is created empty: no INSERT/UPDATE/DELETE/COPY/seed of any kind, no default tenant, no lookup by slug or name', () => {
    for (const { text } of config0052) {
      expect(text, text).not.toMatch(/^(insert|update|delete|truncate|copy) /i);
      expect(text, text).not.toMatch(/insert into/i);
    }
    const create = config0052.find((s) => /^create table "?qa_readonly_tenant_config"?/i.test(s.text));
    expect(create?.text).toMatch(/"authorized_tenant_id" uuid NOT NULL,/);
    expect(create?.text).not.toMatch(/"authorized_tenant_id" uuid[^,]*DEFAULT/i);
    expect(create?.text).toMatch(/CHECK \("qa_readonly_tenant_config"\."singleton"\)/);
    expect(create?.text).not.toMatch(/(?<!authorized_)tenant_id" uuid/);
  });

  it('no GRANT, policy, owner change or RLS statement touches the table (nobody gets a privilege; the owner loses its write privileges)', () => {
    const onTable = config0052.filter((s) => /qa_readonly_tenant_config/i.test(s.text));
    for (const { text } of onTable) {
      expect(text, text).not.toMatch(/^grant /i);
      expect(text, text).not.toMatch(/^create policy|row level security|owner to|with grant option|\bpublic\b.*\bto\b/i);
    }
    expect(onTable.some((s) => /^revoke insert, update, delete, truncate on "?qa_readonly_tenant_config"? from app_migrator;?$/i.test(s.text))).toBe(true);
  });

  it('the scope views read the configuration and the tenant status only: no slug, no name filter, no session variable, no function, no SECURITY DEFINER', () => {
    const views = config0052.filter((s) => /^create or replace view /i.test(s.text));
    expect(views.map((v) => /view (qa_readonly_\w+)/i.exec(v.text)?.[1])).toEqual(['qa_readonly_scope', 'qa_readonly_tenant']);
    for (const { text } of views) {
      expect(text, text).toMatch(/WITH \(security_barrier = true\)/i);
      expect(text, text).toMatch(/qa_readonly_tenant_config/);
      expect(text, text).not.toMatch(/\bwhere\b[^;]*\b(slug|name)\b/i);
      expect(text, text).not.toMatch(/qa-dev-tenant|current_setting|set_config|security definer/i);
    }
    expect(views[0]?.text).toMatch(/t\.status = 'active'/);
    expect(views[0]?.text).not.toMatch(/\bslug\b/);
  });

  it('nothing else mentions the old slug as a scope any more (only 0051 — history — and documentation do)', () => {
    const slugUsers = statements.filter((s) => /'qa-dev-tenant'/.test(s.text)).map((s) => s.tag);
    expect([...new Set(slugUsers)]).toEqual(['0051_qa_readonly_role']);
  });
});
