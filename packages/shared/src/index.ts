/**
 * Framework-agnostic utility functions shared between apps.
 * Business logic does not belong here — only generic, reusable helpers.
 */
import { uuidv7 } from 'uuidv7';

/**
 * Generates a UUIDv7 primary key, in application code, never via a PostgreSQL DEFAULT.
 * See ADR-0016 (docs/decisions/0016-uuid-identifier-strategy.md) — time-ordered ids keep
 * high-write-volume table indexes append-mostly, and the id is known before INSERT so a
 * single transaction can correlate it across multiple tables (e.g. a movement + its outbox event).
 */
export function generateId(): string {
  return uuidv7();
}

export function isNonNullable<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
