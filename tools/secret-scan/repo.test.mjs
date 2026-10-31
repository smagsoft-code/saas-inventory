// Preventive tests on THIS repository (B4.11.5.7): no credential literal in tools/, apps/ or docs/, and the secret-looking keys of .env.example are empty or placeholders.
// Reads only tracked/untracked-but-not-ignored files through `git ls-files` (so `.env` is never listed) and `.env.example` by its explicit name. No value is ever printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isPlaceholder, scanRepository } from './scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('repository', () => {
  it('has no confirmed credential in tools/, apps/ or docs/ (the allowlist records every reviewed exception)', () => {
    const r = scanRepository({ root: ROOT, mode: 'working-tree', prefixes: ['tools', 'apps', 'docs'] });
    const confirmed = r.findings.filter((f) => f.confidence === 'confirmed');
    // path:line:rule only — the scanner never returns a value
    assert.deepEqual(confirmed.map((f) => `${f.path}:${String(f.line)}:${f.rule}`), []);
    assert.ok(r.totals.filesScanned > 500, 'the scan must have looked at the repository');
  });

  it('has no sensitive file name (.env variants, *.pw, key files, dumps) among the files Git knows', () => {
    const r = scanRepository({ root: ROOT, mode: 'working-tree' });
    assert.deepEqual(r.findings.filter((f) => f.rule.startsWith('sensitive-file')).map((f) => f.path), []);
  });

  it('.env.example: every secret-looking key is empty or a placeholder, and no URL carries a real password', () => {
    const text = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const problems = [];
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (/(PASSWORD|SECRET|TOKEN|ACCESS_KEY|SECRET_KEY|API_KEY|PRIVATE_KEY)$/.test(key) && value !== '' && !isPlaceholder(value)) problems.push(`${String(index + 1)}:${key}`);
      const url = /:\/\/[^\s:/@]+:([^\s@]*)@/.exec(value);
      if (url !== null && url[1] !== '' && !isPlaceholder(url[1])) problems.push(`${String(index + 1)}:${key}:url-credentials`);
    }
    assert.deepEqual(problems, []); // line:KEY only
  });
});
