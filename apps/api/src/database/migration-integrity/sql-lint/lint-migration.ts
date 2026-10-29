import { boolOf, defElems, describeRole, isObj, lastName, list, node, relationName, roleOf, stringOf, text, walk } from './ast';
import {
  PROJECT_ROLES,
  PROTECTED_TRIGGER_PATTERN,
  RULES,
  SENSITIVE_SETTINGS,
  SERVER_ACCESS_FUNCTIONS,
  severityOf,
  type LintCategory,
  type LintSeverity,
  type MigrationContext,
} from './rules';
import type { AstObject, SqlParser } from './sql-parser';

/**
 * Lints ONE migration file (ADR-0041, D-8D). Pure over a parser: the SQL is parsed by the PostgreSQL 16 grammar and the rules
 * look at the syntax tree — never at the text. (The only text handling is the split on Drizzle's own `--> statement-breakpoint`
 * marker, exactly as Drizzle splits what it executes, and display-only snippets.)
 *
 * Fail safe: a chunk that does not parse is reported as LINT-PARSE-ERROR (ERROR); a PL/pgSQL body the parser cannot look into
 * is reported as PLPGSQL-UNANALYZED. Nothing unanalysed is ever reported as clean.
 */

export type Certainty = 'high' | 'medium' | 'low';

export interface LintFinding {
  readonly ruleId: string;
  readonly severity: LintSeverity;
  readonly category: LintCategory;
  readonly tag: string;
  /** 1-based line of the statement in the file, when known. */
  readonly line: number | null;
  /** A short, single-line rendering of the statement (display only). */
  readonly operation: string;
  readonly message: string;
  /** How sure the diagnosis is: `high` = read from the syntax tree; `low` = the construct could not be analysed. */
  readonly certainty: Certainty;
  /** Belongs to the bootstrap flow (roles, extensions, session identity). */
  readonly bootstrapRelated: boolean;
  /** Set only by an approved exception; the finding itself is never removed. */
  readonly accepted?: { readonly reason: string; readonly reviewedIn: string };
}

export interface LintTarget {
  readonly tag: string;
  readonly context: MigrationContext;
}

export const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const PLPGSQL_HINTS = ['EXECUTE', 'GRANT', 'REVOKE', 'CREATE ROLE', 'ALTER ROLE', 'DROP ROLE', 'SET ROLE', 'RESET ROLE', 'SECURITY DEFINER', 'ROW LEVEL SECURITY', 'OWNER TO'];

interface Event {
  readonly type: 'enable-rls' | 'force-rls' | 'no-force-rls' | 'disable-trigger' | 'enable-trigger';
  readonly table: string;
  readonly name: string | undefined;
  readonly line: number | null;
  readonly operation: string;
}

/** Line (1-based) of the first token of the statement at `offset`, skipping the whitespace and comments that precede it. */
function lineOfStatement(bytes: Buffer, offset: number, length: number, baseLine: number): number {
  const end = Math.min(bytes.length, offset + length);
  let i = offset;
  while (i < end) {
    const c = bytes[i];
    if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a) {
      i += 1;
    } else if (c === 0x2d && bytes[i + 1] === 0x2d) {
      while (i < end && bytes[i] !== 0x0a) i += 1;
    } else if (c === 0x2f && bytes[i + 1] === 0x2a) {
      let depth = 1;
      i += 2;
      while (i < end && depth > 0) {
        if (bytes[i] === 0x2f && bytes[i + 1] === 0x2a) {
          depth += 1;
          i += 2;
        } else if (bytes[i] === 0x2a && bytes[i + 1] === 0x2f) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
    } else {
      break;
    }
  }
  let newlines = 0;
  for (let j = 0; j < i && j < bytes.length; j += 1) if (bytes[j] === 0x0a) newlines += 1;
  return baseLine + newlines;
}

function snippet(bytes: Buffer, offset: number, length: number): string {
  const raw = bytes.subarray(offset, offset + length).toString('utf8');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('--'));
  const one = lines.join(' ').replace(/\s+/g, ' ');
  return one.length > 110 ? `${one.slice(0, 107)}...` : one;
}

export function lintMigration(parser: SqlParser, sql: string, target: LintTarget): LintFinding[] {
  const findings: LintFinding[] = [];
  const events: Event[] = [];
  let statements = 0;
  let sawGuard = false;

  const emit = (
    ruleId: string,
    line: number | null,
    operation: string,
    message: string,
    options: { severity?: LintSeverity; certainty?: Certainty } = {},
  ): void => {
    const info = RULES[ruleId];
    if (info === undefined) throw new Error(`Unknown lint rule "${ruleId}".`);
    findings.push({
      ruleId,
      severity: options.severity ?? severityOf(ruleId, target.context),
      category: info.category,
      tag: target.tag,
      line,
      operation,
      message,
      certainty: options.certainty ?? 'high',
      bootstrapRelated: info.bootstrap,
    });
  };

  const lintStatement = (kind: string, body: AstObject, line: number | null, operation: string, depth: number): void => {
    const here = (ruleId: string, message: string, options?: { severity?: LintSeverity; certainty?: Certainty }) => emit(ruleId, line, operation, message, options);

    switch (kind) {
      case 'GrantStmt': {
        const isGrant = body['is_grant'] === true;
        const grantees = list(body['grantees']).map(roleOf).filter((r): r is NonNullable<ReturnType<typeof roleOf>> => r !== undefined);
        const names = grantees.map(describeRole).join(', ') || '(none)';
        const objtype = (text(body['objtype']) ?? 'object').replace('OBJECT_', '').toLowerCase();
        if (!isGrant) {
          here('PRIV-REVOKE', `REVOKE on ${objtype} from ${names}: a privilege is being removed; review it against the least-privilege design.`);
          break;
        }
        const reasons: string[] = [];
        if (grantees.some((r) => r.kind === 'public')) reasons.push('it grants to PUBLIC (every role)');
        if (body['grant_option'] === true) reasons.push('it uses WITH GRANT OPTION');
        const foreign = grantees.filter((r) => r.kind === 'special' || (r.kind === 'named' && !PROJECT_ROLES.has(r.name)));
        if (foreign.length > 0) reasons.push(`the grantee(s) ${foreign.map(describeRole).join(', ')} are not project roles`);
        if (reasons.length > 0) here('PRIV-GRANT-PUBLIC', `GRANT on ${objtype} to ${names}: ${reasons.join('; ')}.`);
        const allInSchema = text(body['targtype']) === 'ACL_TARGET_ALL_IN_SCHEMA';
        const allPrivileges = list(body['privileges']).length === 0;
        if (allInSchema || allPrivileges) {
          here('PRIV-GRANT-BROAD', `GRANT ${allPrivileges ? 'ALL privileges' : 'privileges'} ${allInSchema ? 'on ALL objects of a schema' : `on ${objtype}`} to ${names}: broader than the per-object, per-column grants the design uses.`);
        }
        if (reasons.length === 0 && !allInSchema && !allPrivileges) here('PRIV-GRANT', `GRANT on ${objtype} to project role(s) ${names}: a privilege change that needs review.`);
        break;
      }
      case 'GrantRoleStmt':
        here('PRIV-ROLE-MEMBERSHIP', `${body['is_grant'] === true ? 'GRANT' : 'REVOKE'} of a role membership: changes who can act as another role.`);
        break;
      case 'AlterOwnerStmt':
        here('PRIV-OWNER-CHANGE', 'ALTER … OWNER TO: changes the owner of an object, and with it who is subject to RLS on it.');
        break;
      case 'CreateSchemaStmt':
        if (isObj(body['authrole'])) here('PRIV-OWNER-CHANGE', 'CREATE SCHEMA … AUTHORIZATION: the schema is created for another owner.');
        break;
      case 'ReassignOwnedStmt':
      case 'DropOwnedStmt':
        here('PRIV-REASSIGN', `${kind === 'ReassignOwnedStmt' ? 'REASSIGN OWNED' : 'DROP OWNED'}: acts on every object a role owns, in the whole database.`);
        break;
      case 'AlterDefaultPrivilegesStmt':
        here('PRIV-DEFAULT-PRIVILEGES', 'ALTER DEFAULT PRIVILEGES: changes the privileges of objects created in the future, invisibly to the migrations that create them.');
        break;
      case 'CreateRoleStmt':
      case 'AlterRoleStmt':
      case 'AlterRoleSetStmt':
      case 'DropRoleStmt': {
        here('ROLE-DDL', `${kind.replace('Stmt', '')}: role administration.`);
        const options = defElems(body['options']);
        const risky = ['superuser', 'createrole', 'createdb', 'replication', 'bypassrls'].filter((name) => boolOf(options.get(name)) === true);
        if (risky.length > 0) here('ROLE-ATTRIBUTES', `The role is given ${risky.map((r) => r.toUpperCase()).join(', ')}.`);
        const setting = body['setstmt'];
        const settingName = isObj(setting) ? text(setting['name']) : undefined;
        if (settingName !== undefined && SENSITIVE_SETTINGS.has(settingName)) here('RLS-SETTING', `ALTER ROLE … SET ${settingName}: changes how row-level security applies to the role.`);
        break;
      }
      case 'VariableSetStmt': {
        const name = text(body['name']);
        const resetAll = text(body['kind']) === 'VAR_RESET_ALL';
        if (name === 'role' || name === 'session_authorization' || resetAll) {
          here('SESSION-IDENTITY', resetAll ? 'RESET ALL: also resets the session role.' : `${text(body['kind']) === 'VAR_RESET' ? 'RESET' : 'SET'} ${name?.toUpperCase().replace('_', ' ')}: changes the identity the rest of the batch runs as.`);
        } else if (name !== undefined && SENSITIVE_SETTINGS.has(name)) {
          here('RLS-SETTING', `SET ${name}: changes how row-level security applies to the session.`);
        }
        break;
      }
      case 'CreatedbStmt':
      case 'DropdbStmt':
      case 'AlterDatabaseStmt':
      case 'AlterDatabaseSetStmt':
      case 'AlterSystemStmt':
      case 'CreateTableSpaceStmt':
      case 'DropTableSpaceStmt':
      case 'AlterTableSpaceOptionsStmt':
      case 'LoadStmt':
        here('ADMIN-DATABASE', `${kind.replace('Stmt', '')}: instance- or database-level administration.`);
        break;
      case 'CreateExtensionStmt':
      case 'AlterExtensionStmt':
      case 'AlterExtensionContentsStmt':
        here('ADMIN-EXTENSION', `${kind.replace('Stmt', '')}: extensions run native code and need privileges.`);
        break;
      case 'CreateFdwStmt':
      case 'AlterFdwStmt':
      case 'CreateForeignServerStmt':
      case 'AlterForeignServerStmt':
      case 'CreateUserMappingStmt':
      case 'AlterUserMappingStmt':
      case 'DropUserMappingStmt':
      case 'ImportForeignSchemaStmt':
      case 'CreateForeignTableStmt':
      case 'CreateEventTrigStmt':
      case 'AlterEventTrigStmt':
      case 'CreatePublicationStmt':
      case 'AlterPublicationStmt':
      case 'CreateSubscriptionStmt':
      case 'AlterSubscriptionStmt':
      case 'DropSubscriptionStmt':
        here('ADMIN-REMOTE', `${kind.replace('Stmt', '')}: reaches outside the database or hooks every DDL command.`);
        break;
      case 'CopyStmt':
        if (body['is_program'] === true) here('ADMIN-FILE-ACCESS', 'COPY … PROGRAM: runs a command on the database server.');
        else if (text(body['filename']) !== undefined) here('ADMIN-FILE-ACCESS', 'COPY from/to a file on the database server.');
        break;
      case 'TransactionStmt': {
        const k = text(body['kind']) ?? '';
        if (k === 'TRANS_STMT_SAVEPOINT' || k === 'TRANS_STMT_RELEASE' || k === 'TRANS_STMT_ROLLBACK_TO') {
          here('TXN-SAVEPOINT', `${k.replace('TRANS_STMT_', '')}: savepoints inside the batch transaction.`);
        } else {
          here('TXN-CONTROL', `${k.replace('TRANS_STMT_', '')}: the batch already runs in ONE transaction that the wrapper and its pre-commit check control; this would end or fork it.`);
        }
        break;
      }
      case 'TruncateStmt':
        here('DATA-TRUNCATE', 'TRUNCATE: removes every row; historical data is never deleted without a documented decision.');
        break;
      case 'DropStmt': {
        const type = text(body['removeType']);
        if (type === 'OBJECT_TABLE' || type === 'OBJECT_SCHEMA') here('DATA-DROP', `DROP ${type.replace('OBJECT_', '')}: destroys data; historical data is never deleted without a documented decision.`);
        else if (type === 'OBJECT_POLICY') here('RLS-POLICY-CHANGE', 'DROP POLICY: removes an isolation rule.');
        else if (type === 'OBJECT_EXTENSION') here('ADMIN-EXTENSION', 'DROP EXTENSION.');
        else if (type === 'OBJECT_TRIGGER') {
          const names = list(body['objects']).map((o) => lastName(isObj(o) && isObj(o['List']) ? (o['List'] as AstObject)['items'] : undefined));
          const protectedName = names.find((n) => n !== undefined && n.toLowerCase().includes(PROTECTED_TRIGGER_PATTERN));
          if (protectedName !== undefined) here('TRIGGER-PROTECTED', `DROP TRIGGER ${protectedName}: a tenant-isolation trigger.`);
          else here('TRIGGER-DROP', 'DROP TRIGGER.');
        }
        break;
      }
      case 'RenameStmt':
        if (text(body['renameType']) === 'OBJECT_COLUMN' && text(body['subname']) === 'tenant_id') here('TENANT-COLUMN', 'RENAME COLUMN tenant_id: tenant isolation is built on that column.');
        break;
      case 'CreatePolicyStmt':
      case 'AlterPolicyStmt': {
        const create = kind === 'CreatePolicyStmt';
        const roles = list(body['roles']).map(roleOf);
        const appliesToPublic = (create && roles.length === 0) || roles.some((r) => r?.kind === 'public');
        if (create) here('RLS-POLICY-CREATE', `CREATE POLICY ${text(body['policy_name']) ?? ''} on ${relationName(body['table']) ?? 'a table'}.`);
        else here('RLS-POLICY-CHANGE', `ALTER POLICY ${text(body['policy_name']) ?? ''}: changes an isolation rule.`);
        if (appliesToPublic) here('RLS-POLICY-PUBLIC', 'The policy applies to PUBLIC (no TO clause, or TO PUBLIC): it also governs the roles that are meant to be outside it.');
        for (const side of ['qual', 'with_check']) {
          const expr = node(body[side]);
          if (expr?.kind === 'A_Const' && isObj(expr.body['boolval']) && (expr.body['boolval'] as AstObject)['boolval'] === true) {
            here('RLS-POLICY-ALWAYS-TRUE', `The ${side === 'qual' ? 'USING' : 'WITH CHECK'} expression is the constant true: the policy filters nothing.`);
          }
        }
        break;
      }
      case 'AlterTableStmt': {
        const table = relationName(body['relation']) ?? '?';
        for (const raw of list(body['cmds'])) {
          const cmd = node(raw);
          if (cmd?.kind !== 'AlterTableCmd') continue;
          const subtype = text(cmd.body['subtype']) ?? '';
          const name = text(cmd.body['name']);
          switch (subtype) {
            case 'AT_DisableRowSecurity':
              here('RLS-DISABLE', `DISABLE ROW LEVEL SECURITY on ${table}: removes tenant isolation from the table.`);
              break;
            case 'AT_EnableRowSecurity':
              events.push({ type: 'enable-rls', table, name: undefined, line, operation });
              here('RLS-ENABLE', `ENABLE ROW LEVEL SECURITY on ${table}.`);
              break;
            case 'AT_ForceRowSecurity':
              events.push({ type: 'force-rls', table, name: undefined, line, operation });
              here('RLS-FORCE', `FORCE ROW LEVEL SECURITY on ${table}.`);
              break;
            case 'AT_NoForceRowSecurity':
              events.push({ type: 'no-force-rls', table, name: undefined, line, operation });
              break;
            case 'AT_DisableTrig':
            case 'AT_DisableTrigAll':
            case 'AT_DisableTrigUser': {
              events.push({ type: 'disable-trigger', table, name, line, operation });
              if (name !== undefined && name.toLowerCase().includes(PROTECTED_TRIGGER_PATTERN)) here('TRIGGER-PROTECTED', `DISABLE TRIGGER ${name} on ${table}: a tenant-isolation trigger.`);
              break;
            }
            case 'AT_EnableTrig':
            case 'AT_EnableAlwaysTrig':
            case 'AT_EnableReplicaTrig':
            case 'AT_EnableTrigAll':
            case 'AT_EnableTrigUser':
              events.push({ type: 'enable-trigger', table, name, line, operation });
              break;
            case 'AT_ChangeOwner':
              here('PRIV-OWNER-CHANGE', `ALTER TABLE ${table} OWNER TO …: changes the owner of the object, and with it who is subject to RLS on it.`);
              break;
            case 'AT_DropColumn':
            case 'AT_DropNotNull':
            case 'AT_AlterColumnType':
              if (name === 'tenant_id') here('TENANT-COLUMN', `${subtype.replace('AT_', '')} on ${table}.tenant_id: tenant isolation is built on that column.`);
              break;
            default:
              break;
          }
        }
        break;
      }
      case 'CreateFunctionStmt': {
        const options = defElems(body['options']);
        const language = (stringOf(options.get('language')) ?? 'sql').toLowerCase();
        if (boolOf(options.get('security')) === true) here('FUNC-SECURITY-DEFINER', 'SECURITY DEFINER: the function runs with its owner\'s privileges, whoever calls it.');
        const bodyText = stringOf(list(node(options.get('as'))?.body['items'])[0]);
        if (language === 'sql') {
          if (bodyText !== undefined && depth < 2) {
            const nested = parser.parse(bodyText);
            if (!nested.ok) here('LINT-PARSE-ERROR', `The body of this SQL function does not parse (${nested.message}); it cannot be analysed.`);
            else for (const s of nested.statements) lintStatement(s.kind, s.body, line, `function body: ${snippet(nested.bytes, s.offset, s.length)}`, depth + 1);
          }
        } else if (language === 'plpgsql') {
          here('PLPGSQL-UNANALYZED', unanalyzedMessage('The body of this function', bodyText), { certainty: 'low' });
        } else {
          here('FUNC-UNTRUSTED-LANGUAGE', `LANGUAGE ${language}: only sql and plpgsql are accepted in a migration.`);
        }
        break;
      }
      case 'AlterFunctionStmt':
        for (const action of list(body['actions'])) {
          const d = node(action);
          if (d?.kind === 'DefElem' && text(d.body['defname']) === 'security' && boolOf(d.body['arg']) === true) here('FUNC-SECURITY-DEFINER', 'ALTER FUNCTION … SECURITY DEFINER.');
        }
        break;
      case 'DoStmt': {
        const options = defElems(body['args']);
        const language = (stringOf(options.get('language')) ?? 'plpgsql').toLowerCase();
        if (language !== 'plpgsql' && language !== 'sql') here('FUNC-UNTRUSTED-LANGUAGE', `DO LANGUAGE ${language}: only plpgsql is accepted in a migration.`);
        else here('PLPGSQL-UNANALYZED', unanalyzedMessage('This DO block', stringOf(options.get('as'))), { certainty: 'low' });
        break;
      }
      case 'ExecuteStmt':
      case 'PrepareStmt':
      case 'CallStmt':
        here('DYN-EXECUTE', `${kind.replace('Stmt', '').toUpperCase()}: executes code the parser cannot see through.`);
        break;
      default:
        break;
    }

    // Function calls anywhere inside the statement (not inside the opaque string of a function body).
    walk(body, (nodeKind, nodeBody) => {
      if (nodeKind === 'FuncCall') {
        const fname = lastName(nodeBody['funcname'])?.toLowerCase();
        if (fname === undefined) return;
        if (SERVER_ACCESS_FUNCTIONS.has(fname)) here('FUNC-SERVER-ACCESS', `${fname}(): reads or writes server files, runs SQL elsewhere, or controls the server.`);
        else if (fname.startsWith('pg_advisory')) here('ADVISORY-LOCK', `${fname}(): advisory locks share a key space with the migration lock.`);
        else if (fname === 'row_security_active') sawGuard = true;
        else if (fname === 'set_config') {
          const setting = stringOf(list(nodeBody['args'])[0]);
          if (setting !== undefined && SENSITIVE_SETTINGS.has(setting)) here('RLS-SETTING', `set_config('${setting}', …): changes how row-level security applies to the session.`);
        }
      } else if (nodeKind === 'ColumnRef') {
        const field = lastName(nodeBody['fields']);
        if (field === 'relforcerowsecurity') sawGuard = true;
      }
    });
  };

  function unanalyzedMessage(subject: string, body: string | undefined): string {
    const upper = (body ?? '').toUpperCase();
    const hints = PLPGSQL_HINTS.filter((h) => upper.includes(h));
    const hint = hints.length > 0 ? ` Lexical hint only (not parsed; a comment or a string can trigger it): the text contains ${hints.join(', ')}.` : '';
    return `${subject} is PL/pgSQL, which the parser (PostgreSQL 16 grammar, no PL/pgSQL parser) cannot look into: dynamic SQL, privileged statements and RLS changes inside it are NOT checked.${hint}`;
  }

  // ---- split exactly as Drizzle does, parse each chunk, evaluate each statement
  const chunks = sql.split(STATEMENT_BREAKPOINT);
  let consumed = 0;
  for (const chunk of chunks) {
    const baseLine = 1 + (sql.slice(0, consumed).match(/\n/g)?.length ?? 0);
    consumed += chunk.length + STATEMENT_BREAKPOINT.length;
    if (chunk.trim() === '') continue;
    const outcome = parser.parse(chunk);
    if (!outcome.ok) {
      const before = outcome.cursor === undefined ? 0 : (chunk.slice(0, Math.max(0, outcome.cursor)).match(/\n/g)?.length ?? 0);
      emit('LINT-PARSE-ERROR', baseLine + before, '(unparsed)', `The SQL does not parse (${outcome.message}); nothing can be said about it, so it is not approved.`);
      continue;
    }
    for (const s of outcome.statements) {
      statements += 1;
      lintStatement(s.kind, s.body, lineOfStatement(outcome.bytes, s.offset, s.length, baseLine), snippet(outcome.bytes, s.offset, s.length), 0);
    }
  }

  // ---- file-level contracts, over the events in order
  const sameTable = (a: Event, b: Event) => a.table === b.table;
  for (const [i, ev] of events.entries()) {
    const later = events.slice(i + 1);
    if (ev.type === 'no-force-rls') {
      const restored = later.some((e) => e.type === 'force-rls' && sameTable(e, ev));
      if (!restored) {
        emit('RLS-WINDOW-UNRESTORED', ev.line, ev.operation, `NO FORCE ROW LEVEL SECURITY on ${ev.table} is never followed by FORCE in this file: the table would be left unprotected from its owner.`);
      } else {
        emit('RLS-WINDOW', ev.line, ev.operation, `NO FORCE window on ${ev.table}, restored by FORCE later in the file. Contract for a window: restored in the same file (checked here), set-based postcondition and identity guard (not provable statically).`);
        if (!sawGuard) {
          emit('RLS-WINDOW-UNGUARDED', ev.line, ev.operation, 'No row_security_active() or relforcerowsecurity check is visible in this file: the window has no verification the parser can see (a DO block would hide one — see PLPGSQL-UNANALYZED).', { certainty: 'medium' });
        }
      }
    }
    if (ev.type === 'enable-rls' && !events.some((e) => e.type === 'force-rls' && sameTable(e, ev))) {
      emit('RLS-ENABLE-WITHOUT-FORCE', ev.line, ev.operation, `ENABLE ROW LEVEL SECURITY on ${ev.table} with no FORCE in this file: the owner (app_migrator) would bypass the policies.`);
    }
    if (ev.type === 'disable-trigger') {
      const reenabled = later.some((e) => e.type === 'enable-trigger' && sameTable(e, ev) && (e.name === ev.name || e.name === undefined || ev.name === undefined));
      if (reenabled) emit('TRIGGER-DISABLE-WINDOW', ev.line, ev.operation, `DISABLE TRIGGER${ev.name !== undefined ? ` ${ev.name}` : ''} on ${ev.table}, re-enabled later in the file.`);
      else emit('TRIGGER-DISABLED-UNRESTORED', ev.line, ev.operation, `DISABLE TRIGGER${ev.name !== undefined ? ` ${ev.name}` : ''} on ${ev.table} is never re-enabled in this file.`);
    }
  }

  if (statements === 0 && !findings.some((f) => f.ruleId === 'LINT-PARSE-ERROR')) {
    emit('LINT-EMPTY', null, '(no statement)', 'The file contains no statement: Drizzle would record it as applied while it does nothing.');
  }
  return findings;
}
