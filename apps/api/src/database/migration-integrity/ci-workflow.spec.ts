import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static checks of `.github/workflows/ci.yml` (ADR-0041, D-8E). They read the file as text: they prove the workflow DECLARES the
 * pinned image, the loopback-only binding, the version check, the frozen install, the cleanup and the suite order. They do NOT prove
 * the workflow runs — only a real GitHub Actions run does (see docs/architecture/migration-integrity.md, "CI").
 */

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const yml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const PG_JOBS = ['migration-harness', 'pg-verify', 'qa-readonly-isolation'];
const DIGEST = /^postgres:16\.15@sha256:[0-9a-f]{64}$/;

/** The text of one top-level job (from `  name:` to the next two-space-indented key). */
function job(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`job ${name} not found`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(rest.indexOf('\n') + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}

describe('ci.yml — PostgreSQL 16.15 migration jobs', () => {
  const images = [...yml.matchAll(/^\s+POSTGRES_IMAGE:\s*(\S+)\s*$/gm)].map((m) => m[1] as string);

  it('declares the image in all three jobs, pinned to 16.15 by digest, identical in all, never latest or another major', () => {
    expect(images).toHaveLength(3);
    for (const image of images) expect(image).toMatch(DIGEST);
    expect(new Set(images).size).toBe(1);
    expect(yml).not.toMatch(/postgres:(latest|1[0-57-9]|[2-9]\d)\b/);
    expect(yml).not.toMatch(/image:\s*postgres/); // no floating service container
  });

  it('expects server_version_num 160015 and checks it on the RUNNING server in both jobs', () => {
    expect(yml.match(/EXPECTED_SERVER_VERSION_NUM: '160015'/g)).toHaveLength(3);
    for (const name of PG_JOBS) {
      const text = job(name);
      expect(text).toContain('SHOW server_version_num');
      expect(text).toContain('test "${NUM}" = "${EXPECTED_SERVER_VERSION_NUM}"');
    }
  });

  it('publishes the container on 127.0.0.1 with an ephemeral host port and refuses protected ports', () => {
    for (const name of PG_JOBS) {
      const text = job(name);
      expect(text).toContain('-p 127.0.0.1::5432');
      expect(text).not.toMatch(/-p\s+5432:/);
      expect(text).not.toMatch(/-p\s+0\.0\.0\.0/);
      expect(text).toContain('5432|55432|55433|55440');
    }
  });

  it('generates the password at run time and masks it, never writing a literal one', () => {
    for (const name of PG_JOBS) {
      const text = job(name);
      expect(text).toContain('openssl rand');
      expect(text).toContain('::add-mask::${PASSWORD}');
      expect(text).toContain('::add-mask::${URL}');
      expect(text).not.toMatch(/POSTGRES_PASSWORD[=:]\s*['"]?[A-Za-z0-9]+['"]?\s*(\\|$)/m);
    }
  });

  it('uses a unique container per job and removes only that container, even on failure', () => {
    expect(job('migration-harness')).toContain('CONTAINER_NAME: saas-mig-harness-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(job('pg-verify')).toContain('CONTAINER_NAME: saas-pgverify-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(job('qa-readonly-isolation')).toContain('CONTAINER_NAME: saas-qaro-${{ github.run_id }}-${{ github.run_attempt }}');
    for (const name of PG_JOBS) {
      const text = job(name);
      expect(text).toMatch(/if: always\(\)\n\s+run: (\|\n\s+)?docker rm -f "\$\{CONTAINER_NAME\}"/);
    }
    expect(yml).not.toMatch(/docker (system|container|volume|image) prune/);
    expect(yml).not.toMatch(/docker rm -f \$\(/);
  });

  it('installs with the frozen lockfile in every job and on the same Node major as the existing job', () => {
    expect(yml.match(/pnpm install --frozen-lockfile/g)).toHaveLength(4);
    expect(yml.match(/node-version: 20/g)).toHaveLength(4);
    expect(yml).not.toMatch(/pnpm install(?! --frozen-lockfile)/);
  });

  it('runs the harness suites in the mandatory order: install, version, typecheck, lint, unit, linter CLI, harness, diff check', () => {
    const text = job('migration-harness');
    const order = [
      'pnpm install --frozen-lockfile',
      'SHOW server_version_num',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test\n',
      'sql-lint.cli.ts',
      'pnpm test:migration-harness',
      'git diff --check',
    ].map((needle) => text.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('points the harness and pg-verify at the CI server by URL (neither starts its own) and asserts the version number', () => {
    expect(job('migration-harness')).toContain('MIGRATION_HARNESS_SERVER_URL=');
    expect(job('migration-harness')).toContain('MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM');
    expect(job('pg-verify')).toContain('PG_VERIFY_SERVER_URL=');
    expect(job('pg-verify')).toContain('PG_VERIFY_EXPECTED_SERVER_VERSION_NUM');
    expect(job('pg-verify')).toContain('pnpm --filter @saas-inventory/pg-verify verify');
  });

  it('uploads diagnostics only on failure and only the container log and state (no environment, no URL)', () => {
    for (const name of PG_JOBS) {
      const text = job(name);
      // `|| cancelled()`: a hung step that is cancelled or timed out must still leave its diagnostics (D-8E.14).
      expect(text).toMatch(/if: failure\(\) \|\| cancelled\(\)\n\s+uses: actions\/upload-artifact@v4/);
      expect(text).toMatch(/- name: Collect secret-free diagnostics\n\s+if: failure\(\) \|\| cancelled\(\)/);
      expect(text).toContain('docker logs');
      expect(text).not.toMatch(/\benv\b\s*>|printenv|set \+x|\$\{URL\}.*diagnostics/);
    }
  });

  it('restricts the token to contents: read at workflow level, with no job-level override, secrets or deployments', () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read\n(?! {2}\S)/m);
    expect(yml.match(/^\s*permissions:/gm)).toHaveLength(1);
    expect(yml).not.toMatch(/:\s*write\b/);
    expect(yml).not.toContain('secrets.');
    expect(yml).not.toMatch(/deploy|environment:/i);
  });

  it('B4.11.5: qa-readonly-isolation runs the role tests against its own fresh 16.15 server, after the version check, and reports a failing cleanup', () => {
    const text = job('qa-readonly-isolation');
    expect(text).toContain('QA_RO_SERVER_URL=');
    expect(text).toContain('QA_RO_EXPECTED_SERVER_VERSION_NUM');
    expect(text).toContain('pnpm test:qa-readonly');
    expect(text).toContain('set -o pipefail');
    expect(text).toContain('GITHUB_STEP_SUMMARY');
    expect(text.indexOf('SHOW server_version_num')).toBeLessThan(text.indexOf('pnpm test:qa-readonly'));
    expect(text).not.toContain('2>&1 || true\n          if docker ps');
    expect(text).toContain('still exists'); // a cleanup failure fails the job
    expect(text).not.toMatch(/\.env\b|taskkill|pkill|killall|rm -rf/);
  });
});
