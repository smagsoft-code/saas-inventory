/**
 * Mirrors `apps/api/src/qr/qr-codes/dto/*` — the QR management contract (Prompt 09, mobile.md#qr).
 * Kept local to the frontend, the same convention as `lib/types/catalog.ts`.
 *
 * Endpoints (all tenant-scoped — `tenantId` from `@CurrentTenant()`, never sent; full guard chain
 * JwtAuthGuard → TenantGuard → CsrfGuard → PermissionsGuard):
 *  - `GET   /api/v1/qr-codes?page&pageSize&targetType?&targetId?`  (`catalog.qr.manage`) → PaginatedResult<QrCode>
 *  - `GET   /api/v1/qr-codes/:id`                                  (`catalog.qr.manage`) → QrCode
 *  - `POST  /api/v1/qr-codes`                                      (`catalog.qr.manage`) → QrCode (201)
 *  - `PATCH /api/v1/qr-codes/:id`   body `{ status: 'revoked' }`   (`catalog.qr.manage`) → QrCode
 *  - `GET   /api/v1/qr-codes/resolve/:code`                        (auth, no permission)
 *  - `GET   /q/:code`                                              (public, unauthenticated)
 *
 * `targetId` comes back as a raw id (`GAP-NAME-ENRICHMENT` — "target name = B"): a location id is
 * resolved via the bounded `GET /locations` fetch, a variant id has no tenant-wide list
 * (`GAP-VARIANT-LIST`) so it shows a short id. The DTO carries `code` (the opaque token printed on
 * the physical label) but **no image** — the printable URL is `/q/:code`; the UI shows the token +
 * that URL, it does not render a QR bitmap (no new dependency).
 */

export const QR_TARGET_TYPES = ['product_variant', 'location'] as const;
export type QrTargetType = (typeof QR_TARGET_TYPES)[number];

export const QR_TARGET_TYPE_LABELS: Record<QrTargetType, string> = {
  product_variant: 'Product variant',
  location: 'Location',
};

export const QR_STATUSES = ['active', 'revoked'] as const;
export type QrStatus = (typeof QR_STATUSES)[number];

export function qrStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'revoked':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `GET /qr-codes` item / `GET /qr-codes/:id` / every mutation response — `QrCodeResponseDto`. */
export interface QrCode {
  id: string;
  code: string;
  targetType: string;
  targetId: string;
  status: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /qr-codes` body — `CreateQrCodeDto`. No `tenantId`/`code`/`id`/`status` (server-derived;
 * `forbidNonWhitelisted` rejects extras). `expiresAt` is an optional ISO date-time. */
export interface CreateQrCodeInput {
  targetType: QrTargetType;
  targetId: string;
  expiresAt?: string;
}

/** Whether a QR code is past its `expiresAt` (display hint only — the backend enforces expiry at
 * resolve time). */
export function isQrExpired(qr: Pick<QrCode, 'expiresAt'>, now: Date = new Date()): boolean {
  return qr.expiresAt !== undefined && new Date(qr.expiresAt).getTime() <= now.getTime();
}
