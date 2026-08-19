/**
 * Generic environment-variable access shared by every app.
 * Concrete env schemas (which vars an app requires) are defined per-app,
 * not here — this only provides the safe read primitive.
 */

export class MissingEnvVarError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = 'MissingEnvVarError';
  }
}

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new MissingEnvVarError(name);
  }
  return value;
}

export function getOptionalEnvVar(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
