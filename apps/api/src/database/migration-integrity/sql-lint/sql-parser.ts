import { loadModule, parseSync } from 'libpg-query';

/**
 * The one place that touches the SQL parser (ADR-0041, D-8D). Everything else in `sql-lint/` works on the plain objects this
 * returns, so the parser can be replaced without touching a rule.
 *
 * Parser: `libpg-query@16.8.1` — the PostgreSQL 16 grammar itself (the server's own `gram.y`, compiled to WebAssembly), MIT,
 * no native build, no runtime dependency (`@pgsql/types` is types only). Pinned exactly. Target server: 16.15.
 *
 * What it can and cannot do (verified against this build):
 *  - It parses every SQL statement of the PostgreSQL 16 grammar, and tells comments, string and dollar-quoted literals and quoted
 *    identifiers apart from statements, because it is the real lexer.
 *  - It exports no PL/pgSQL parser and no tokenizer: the BODY of a `DO` block or of a `LANGUAGE plpgsql` function arrives as an
 *    opaque string. The linter therefore cannot look inside it (rule PLPGSQL-UNANALYZED) — it reports that, it never calls such a
 *    body clean.
 *  - A statement it cannot parse makes the whole chunk unanalysable (LINT-PARSE-ERROR); it does not guess.
 */

export type AstObject = Readonly<Record<string, unknown>>;

export interface ParsedStatement {
  /** The node kind, for example `GrantStmt`. */
  readonly kind: string;
  /** The node body (the fields of that kind). */
  readonly body: AstObject;
  /** Byte offset of the statement inside the parsed text, and its length in bytes. */
  readonly offset: number;
  readonly length: number;
}

export type ParseOutcome =
  | { readonly ok: true; readonly statements: readonly ParsedStatement[]; readonly bytes: Buffer }
  | { readonly ok: false; readonly message: string; readonly cursor: number | undefined };

export interface SqlParser {
  parse(sql: string): ParseOutcome;
}

export const PARSER_INFO = Object.freeze({ package: 'libpg-query', version: '16.8.1', grammar: 'PostgreSQL 16', runtime: 'WebAssembly' });

const isObject = (value: unknown): value is AstObject => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function loadSqlParser(): Promise<SqlParser> {
  await loadModule();
  return {
    parse(sql: string): ParseOutcome {
      let tree: unknown;
      try {
        tree = parseSync(sql);
      } catch (error) {
        const details = (error as { sqlDetails?: { message?: unknown; cursorPosition?: unknown } }).sqlDetails;
        const message = typeof details?.message === 'string' ? details.message : error instanceof Error ? error.message : 'parse error';
        const cursor = typeof details?.cursorPosition === 'number' ? details.cursorPosition : undefined;
        return { ok: false, message, cursor };
      }
      const stmts = isObject(tree) && Array.isArray(tree['stmts']) ? (tree['stmts'] as unknown[]) : undefined;
      if (stmts === undefined) return { ok: false, message: 'unexpected parser output (no "stmts")', cursor: undefined };
      const statements: ParsedStatement[] = [];
      for (const entry of stmts) {
        const stmt = isObject(entry) ? entry['stmt'] : undefined;
        if (!isObject(stmt)) return { ok: false, message: 'unexpected parser output (a statement without "stmt")', cursor: undefined };
        const kind = Object.keys(stmt)[0];
        const body = kind === undefined ? undefined : stmt[kind];
        if (kind === undefined || !isObject(body)) return { ok: false, message: 'unexpected parser output (an unrecognised node)', cursor: undefined };
        const offset = isObject(entry) && typeof entry['stmt_location'] === 'number' ? entry['stmt_location'] : 0;
        const length = isObject(entry) && typeof entry['stmt_len'] === 'number' ? entry['stmt_len'] : Buffer.byteLength(sql) - offset;
        statements.push({ kind, body, offset, length });
      }
      return { ok: true, statements, bytes: Buffer.from(sql, 'utf8') };
    },
  };
}
