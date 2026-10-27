import { inflateSync } from 'node:zlib';
import { generateId } from '@saas-inventory/shared';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import * as schema from '../../src/database/schema';
import { getMigratorDb } from '../database/helpers';

/**
 * Shared helpers for the HTTP tenant-isolation sweep (GAP-F19-RLS-IDOR-DEPTH, test/security/*).
 * Everything here goes through the real `buildApp()` over HTTP (`inject`) against real PostgreSQL;
 * the only direct database access is the migrator connection used to (a) seed a platform admin,
 * and (b) READ state back after an attack to prove there was no side effect.
 */

export const uniq = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const PLATFORM_PASSWORD = 'a-very-long-platform-admin-password';

/** Runs `fn` with a short-lived migrator (superuser, RLS-bypassing) connection — read-back only. */
export async function withDb<T>(fn: (db: ReturnType<typeof getMigratorDb>['db']) => Promise<T>): Promise<T> {
  const { client, db } = getMigratorDb();
  try {
    return await fn(db);
  } finally {
    await client.end();
  }
}

export async function seedPlatformAdmin(): Promise<{ id: string; email: string }> {
  const email = `iso-superadmin-${generateId()}@example.com`;
  const passwordHash = await argon2.hash(PLATFORM_PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
  const id = generateId();
  await withDb((db) => db.insert(schema.platformAdmins).values({ id, email, passwordHash, fullName: 'Isolation SuperAdmin' }));
  return { id, email };
}

export interface PlatformSession {
  admin: { id: string; email: string };
  accessToken: string;
  csrfToken: string;
}

export function makePlatformClient(app: NestFastifyApplication) {
  const inject = (options: { method: HTTPMethods; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse> =>
    app.getHttpAdapter().getInstance().inject(options as InjectOptions);

  const cookieValue = (response: LightMyRequestResponse, name: string): string | undefined => {
    const raw = response.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const entry of values) {
      const [pair] = entry.split(';');
      const [key, value] = (pair ?? '').split('=');
      if (key === name) return value;
    }
    return undefined;
  };

  const headers = (s: PlatformSession): Record<string, string> => ({
    cookie: `platform_access_token=${s.accessToken}; platform_csrf_token=${s.csrfToken}`,
    'x-csrf-token': s.csrfToken,
  });

  /** A fresh platform admin, already logged in — one per test so a live support session never leaks between tests. */
  async function newAdmin(): Promise<PlatformSession> {
    const seeded = await seedPlatformAdmin();
    const response = await inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: seeded.email, password: PLATFORM_PASSWORD } });
    expect(response.statusCode, response.body).toBe(200);
    return { admin: seeded, accessToken: cookieValue(response, 'platform_access_token')!, csrfToken: cookieValue(response, 'platform_csrf_token')! };
  }

  return { inject, cookieValue, headers, newAdmin };
}

/** Every cell of every sheet of an .xlsx, as one lowercase string — to assert a marker is (not) present in a download. */
export async function xlsxText(buffer: Buffer | Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        parts.push(String(cell.text ?? cell.value ?? ''));
      });
    });
  });
  return parts.join('\n').toLowerCase();
}

/** The call must NOT have succeeded: a 4xx from the allowed set, never a 2xx/3xx/5xx. `label` makes a failure self-explanatory. */
export function expectDenied(res: { statusCode: number; body: string }, allowed: number[], label: string): void {
  expect(allowed, `${label} -> ${res.statusCode} ${res.body.slice(0, 200)}`).toContain(res.statusCode);
}

/** The response body must not contain any of the given foreign markers (ids, emails, names, codes) — case-insensitive. */
export function expectNoLeak(text: string, markers: string[], label: string): void {
  const haystack = text.toLowerCase();
  for (const marker of markers) {
    expect(haystack.includes(marker.toLowerCase()), `${label}: foreign marker "${marker}" leaked`).toBe(false);
  }
}

/** Number of non-empty rows of the first sheet of an .xlsx (header included). */
export async function xlsxRowCount(buffer: Buffer | Uint8Array): Promise<number> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  let n = 0;
  sheet?.eachRow(() => {
    n += 1;
  });
  return n;
}

/**
 * The text a pdfkit-generated PDF draws (lowercase): inflates every content stream and decodes the `[<hex> kern <hex> …] TJ` arrays,
 * joining the pieces of one array (pdfkit splits a string at every kerning pair). pdfkit's built-in Helvetica writes the characters
 * as single bytes, so no font mapping is needed. Good enough to assert that a marker is (not) in a download; not a general PDF parser.
 */
export function pdfText(buffer: Buffer | Uint8Array): string {
  const raw = Buffer.from(buffer);
  const source = raw.toString('latin1');
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const marker = source.indexOf('stream', pos);
    if (marker < 0) break;
    let start = marker + 'stream'.length;
    if (source.startsWith('\r\n', start)) start += 2;
    else if (source[start] === '\n') start += 1;
    const end = source.indexOf('endstream', start);
    if (end < 0) break;
    pos = end + 'endstream'.length;
    let content: string;
    try {
      content = inflateSync(raw.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    for (const array of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...array[1]!.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((h) => Buffer.from(h[1]!.replace(/\s+/g, ''), 'hex').toString('latin1')).join(''));
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) out.push(Buffer.from(hex[1]!.replace(/\s+/g, ''), 'hex').toString('latin1'));
  }
  return out.join('\n').toLowerCase();
}
