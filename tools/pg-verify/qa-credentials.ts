import { existsSync, readFileSync } from 'node:fs';

/**
 * The QA administrator of the development tenant (D-8E.24). The password is NEVER written in the repository: it comes from
 * `QA_ADMIN_PASSWORD` (process environment, or the git-ignored root `.env`). There is no default, and no message, log or
 * error of this module ever contains the value.
 */

export interface QaAdmin {
  readonly companyName: string;
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
}

export class QaCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QaCredentialsError';
  }
}

export const QA_PASSWORD_MIN_LENGTH = 12;
export const QA_PASSWORD_MAX_LENGTH = 128;
const DEFAULT_EMAIL = 'qa-admin@dev.local';
const DEFAULT_COMPANY = 'QA Dev Tenant';
const DEFAULT_FULL_NAME = 'QA Admin';

/** Builds the QA admin from an environment record. Throws `QaCredentialsError` naming only the variable, never a value. */
export function loadQaAdmin(env: Readonly<Record<string, string | undefined>>): QaAdmin {
  const password = env['QA_ADMIN_PASSWORD'];
  if (password === undefined || password === '') {
    throw new QaCredentialsError('QA_ADMIN_PASSWORD is not set. Define it in your environment or in the git-ignored .env (no default exists).');
  }
  if (password.length < QA_PASSWORD_MIN_LENGTH || password.length > QA_PASSWORD_MAX_LENGTH) {
    throw new QaCredentialsError(`QA_ADMIN_PASSWORD must be between ${String(QA_PASSWORD_MIN_LENGTH)} and ${String(QA_PASSWORD_MAX_LENGTH)} characters.`);
  }
  const email = (env['QA_ADMIN_EMAIL'] ?? '').trim() || DEFAULT_EMAIL;
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new QaCredentialsError('QA_ADMIN_EMAIL is not a valid address.');
  }
  return {
    companyName: (env['QA_ADMIN_COMPANY_NAME'] ?? '').trim() || DEFAULT_COMPANY,
    email,
    password,
    fullName: (env['QA_ADMIN_FULL_NAME'] ?? '').trim() || DEFAULT_FULL_NAME,
  };
}

/** A minimal `.env` parser: `KEY=VALUE` lines, `#` comments and blank lines skipped. */
export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

/** The environment a tool should use: the root `.env` (if present) overridden by the real process environment. */
export function readToolEnv(envFilePath: string, processEnv: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const fromFile = existsSync(envFilePath) ? parseEnvText(readFileSync(envFilePath, 'utf8')) : {};
  return { ...fromFile, ...processEnv };
}
