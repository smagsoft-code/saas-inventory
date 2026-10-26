import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GAP-F19-PARSE-UUID regression guard. A malformed UUID in a path parameter used to reach PostgreSQL
 * and surface as HTTP 500 (`22P02`). Every path parameter must therefore be validated at the edge
 * with `ParseUUIDPipe` — EXCEPT the few that are deliberately not UUIDs.
 *
 * This is a source-level check (cheap, exhaustive across every controller, fails the moment someone
 * adds an unguarded `@Param`). The behavioural proof, against a real PostgreSQL, is
 * `test/http/http-input-validation.integration.test.ts`.
 */

/** Path parameters whose value is NOT a UUID: opaque tokens. Adding a name here needs a reason. */
const NON_UUID_PARAMS: Record<string, string> = {
  code: 'opaque QR token (randomBytes), never a UUID — qr-public.controller / qr-codes.controller',
  token: 'one-time invitation token (HMAC-hashed), never a UUID — auth.controller',
};

const SRC_ROOT = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...controllerFiles(path));
    else if (name.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

describe('UUID path parameters (GAP-F19-PARSE-UUID)', () => {
  const files = controllerFiles(SRC_ROOT);

  it('finds the controllers', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('every @Param("…") is wrapped with ParseUUIDPipe, except the documented non-UUID tokens', () => {
    const offenders: string[] = [];
    let guarded = 0;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/@Param\(\s*'([A-Za-z]+)'\s*(?:,\s*([A-Za-z]+)\s*)?\)/g)) {
        const [, name, pipe] = match;
        if (name !== undefined && name in NON_UUID_PARAMS) {
          expect(pipe, `${name} is a non-UUID token and must NOT be forced through ParseUUIDPipe`).toBeUndefined();
          continue;
        }
        if (pipe === 'ParseUUIDPipe') guarded += 1;
        else offenders.push(`${relative(SRC_ROOT, file)}: @Param('${name}')`);
      }
    }
    expect(offenders, `unguarded path params:\n${offenders.join('\n')}`).toEqual([]);
    expect(guarded).toBeGreaterThanOrEqual(81);
  });

  it('there is no bare @Param() that would bypass the check, and every guarded file imports the pipe', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(/@Param\(\s*\)/.test(src), `${relative(SRC_ROOT, file)} uses a bare @Param()`).toBe(false);
      if (/ParseUUIDPipe\)/.test(src)) {
        expect(/import \{[^}]*\bParseUUIDPipe\b[^}]*\} from '@nestjs\/common'/s.test(src), `${relative(SRC_ROOT, file)} must import ParseUUIDPipe`).toBe(true);
      }
    }
  });
});
