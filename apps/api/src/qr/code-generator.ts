import { randomBytes } from 'node:crypto';

/**
 * `qr_codes.code` (database.md#qr-codes): "a globally-unique, high-entropy opaque token, generated
 * in application code, not a sequential value" — deliberately NOT `generateId()` (packages/shared),
 * which is a UUIDv7 chosen specifically for time-ordering (ADR-0016), the opposite property wanted
 * here: `code` is meant to be publicly presented (printed on a physical QR label) and must not leak
 * creation order. Same "opaque, high-entropy random token" shape already established by
 * auth/tokens/refresh-token.service.ts's refresh tokens — `randomBytes(...).toString('base64url')`,
 * no new crypto approach introduced for QR specifically. 24 bytes (192 bits) keeps the encoded
 * string short enough for a compact QR image while leaving collision probability astronomically
 * low; the database's `UNIQUE (code)` constraint (never this function) is the actual authority — see
 * qr-codes.repository.ts's insert-and-retry-on-conflict, never SELECT-then-INSERT.
 */
export function generateQrCode(): string {
  return randomBytes(24).toString('base64url');
}
