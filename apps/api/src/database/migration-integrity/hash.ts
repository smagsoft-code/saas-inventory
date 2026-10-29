import { createHash } from 'node:crypto';

/**
 * Hashes of a migration file.
 *
 * Two different questions, two different functions:
 *
 * 1. `hashMigrationSql` — what `drizzle-orm` REGISTERS in `drizzle.__drizzle_migrations.hash`:
 *    SHA-256 (hex) of the file's text exactly as read (`readMigrationFiles`:
 *    `fs.readFileSync(file).toString()` then `createHash('sha256').update(query)`; verified against
 *    drizzle-orm 0.45.2). It depends on the file's line endings.
 *
 * 2. `canonicalMigrationHash` — the hash kept in the version-controlled manifests: the same SHA-256
 *    over the text with CRLF normalised to LF. The repository has no `.gitattributes` and Windows
 *    checkouts with `core.autocrlf=true` turn the files into CRLF, which changes the raw hash without
 *    changing the migration. The manifest must not depend on who cloned where.
 *
 * Because a database may have been migrated from a checkout with either line ending, the registry
 * hash is compared with `registryHashCandidates` (raw, LF and CRLF variants of the CURRENT file): a
 * file whose only difference is its line endings still matches; any change of content does not.
 */
export function hashMigrationSql(sqlText: string): string {
  return sha256(sqlText);
}

export function canonicalMigrationHash(sqlText: string): string {
  return sha256(toLf(sqlText));
}

/** Every hash Drizzle could have registered for this file's content, whatever the line endings. */
export function registryHashCandidates(sqlText: string): string[] {
  const lf = toLf(sqlText);
  return [...new Set([sha256(sqlText), sha256(lf), sha256(lf.replace(/\n/g, '\r\n'))])];
}

function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
