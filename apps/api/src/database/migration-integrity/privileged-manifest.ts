import { diagnostic, type Diagnostic, type FileHashes, type JournalEntry } from './types';

/**
 * Migrations that need more than the incremental login can do (ADR-0041, decisions 1–3):
 * `CREATE ROLE`, `CREATE EXTENSION`, a `BYPASSRLS` role, `RESET ROLE`. They run only in bootstrap
 * mode. The list is `database/migrations/privileged-manifest.json`, edited by hand and reviewed;
 * the generator never touches it.
 */

export interface PrivilegedEntry {
  readonly tag: string;
  readonly sha256: string;
  readonly reason: string;
}

export interface PrivilegedManifest {
  readonly manifestVersion: 1;
  readonly entries: readonly PrivilegedEntry[];
}

export const PRIVILEGED_MANIFEST_FILE = 'privileged-manifest.json';

/** Always privileged, whatever else the manifest says (ADR-0041 decision 2). */
export const REQUIRED_PRIVILEGED_TAGS = ['0000_extensions_and_roles', '0019_import_worker_role'] as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parsePrivilegedManifest(text: string): { manifest: PrivilegedManifest | null; diagnostics: Diagnostic[] } {
  const bad = (message: string): { manifest: null; diagnostics: Diagnostic[] } => ({
    manifest: null,
    diagnostics: [diagnostic('PRIVILEGED_MANIFEST_MALFORMED', message)],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('The privileged manifest is not valid JSON.');
  }
  const m = raw as { manifestVersion?: unknown; entries?: unknown } | null;
  if (typeof m !== 'object' || m === null || m.manifestVersion !== 1 || !Array.isArray(m.entries)) {
    return bad('The privileged manifest must have manifestVersion 1 and an "entries" array.');
  }
  const entries: PrivilegedEntry[] = [];
  for (const [position, item] of m.entries.entries()) {
    const e = item as Partial<Record<keyof PrivilegedEntry, unknown>> | null;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.tag !== 'string' ||
      typeof e.sha256 !== 'string' ||
      !SHA256_HEX.test(e.sha256) ||
      typeof e.reason !== 'string' ||
      e.reason.trim() === ''
    ) {
      return bad(`Privileged manifest entry at position ${position} needs tag, a 64-hex sha256 and a non-empty reason.`);
    }
    entries.push({ tag: e.tag, sha256: e.sha256, reason: e.reason });
  }
  return { manifest: { manifestVersion: 1, entries }, diagnostics: [] };
}

export function privilegedTags(manifest: PrivilegedManifest): ReadonlySet<string> {
  return new Set(manifest.entries.map((e) => e.tag));
}

/** Consistency of the privileged manifest with the journal and the real files. */
export function validatePrivilegedManifest(
  manifest: PrivilegedManifest,
  entries: readonly JournalEntry[],
  fileHashes: FileHashes,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const journalTags = new Set(entries.map((e) => e.tag));
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.tag)) {
      out.push(diagnostic('PRIVILEGED_MANIFEST_DUPLICATE', `Privileged manifest lists "${entry.tag}" more than once.`, { migration: entry.tag }));
    }
    seen.add(entry.tag);
    if (!journalTags.has(entry.tag)) {
      out.push(diagnostic('PRIVILEGED_MANIFEST_TAG_UNKNOWN', `Privileged manifest lists "${entry.tag}", which is not in the journal.`, { migration: entry.tag }));
      continue;
    }
    const actual = fileHashes[entry.tag];
    if (actual !== null && actual !== undefined && actual !== entry.sha256) {
      out.push(
        diagnostic('PRIVILEGED_MANIFEST_HASH_MISMATCH', `The SQL file of privileged migration "${entry.tag}" does not match the privileged manifest.`, {
          migration: entry.tag,
          details: { manifestSha256: entry.sha256, fileSha256: actual },
        }),
      );
    }
  }
  for (const tag of REQUIRED_PRIVILEGED_TAGS) {
    if (!seen.has(tag)) {
      out.push(diagnostic('PRIVILEGED_MANIFEST_REQUIRED_MISSING', `"${tag}" must always be listed as privileged.`, { migration: tag }));
    }
  }
  return out;
}

/**
 * Statements that need privileges the incremental login does not have. A heuristic over the SQL text
 * with comments removed: it is a safety net that finds a privileged migration nobody declared, not a
 * parser (string literals are not understood; a match inside one is a false positive that a human
 * resolves by declaring the migration or rewording it). The migration linter (a later delivery)
 * supersedes it.
 */
const PRIVILEGED_STATEMENT_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'CREATE ROLE', pattern: /\bCREATE\s+ROLE\b/i },
  { name: 'ALTER ROLE', pattern: /\bALTER\s+ROLE\b/i },
  { name: 'DROP ROLE', pattern: /\bDROP\s+ROLE\b/i },
  { name: 'CREATE EXTENSION', pattern: /\bCREATE\s+EXTENSION\b/i },
  { name: 'RESET ROLE', pattern: /\bRESET\s+ROLE\b/i },
  { name: 'SET ROLE', pattern: /\bSET\s+(?:LOCAL\s+|SESSION\s+)?ROLE\b/i },
  { name: 'SET SESSION AUTHORIZATION', pattern: /\bSET\s+(?:LOCAL\s+|SESSION\s+)?SESSION\s+AUTHORIZATION\b/i },
];

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ');
}

export function findPrivilegedStatements(sql: string): string[] {
  const text = stripSqlComments(sql);
  return PRIVILEGED_STATEMENT_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/** Reports every migration whose SQL contains a privileged statement but is not in the manifest. */
export function findUndeclaredPrivileged(
  manifest: PrivilegedManifest,
  entries: readonly JournalEntry[],
  sqlByTag: Readonly<Record<string, string | undefined>>,
): Diagnostic[] {
  const declared = privilegedTags(manifest);
  const out: Diagnostic[] = [];
  for (const entry of entries) {
    const sql = sqlByTag[entry.tag];
    if (sql === undefined || declared.has(entry.tag)) continue;
    const found = findPrivilegedStatements(sql);
    if (found.length > 0) {
      out.push(
        diagnostic(
          'PRIVILEGED_STATEMENT_UNDECLARED',
          `"${entry.tag}" contains ${found.join(', ')} but is not declared in the privileged manifest.`,
          { migration: entry.tag, details: { statements: found.join(', ') } },
        ),
      );
    }
  }
  return out;
}
