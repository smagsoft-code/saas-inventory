import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { AuditLogService } from '../common/audit/audit-log.service';
import { QrCodesController } from './qr-codes/qr-codes.controller';
import { QrCodesService } from './qr-codes/qr-codes.service';
import { QrPublicController } from './public/qr-public.controller';
import { QrPublicRepository } from './public/qr-public.repository';
import { QrPublicService } from './public/qr-public.service';
import { QrCodesRepository } from './repositories/qr-codes.repository';
import { QrTargetsRepository } from './repositories/qr-targets.repository';

/**
 * modules.md#qr — "generating and resolving QR codes that point at a product or a location."
 * "Depends on: CATALOG (product QR), INVENTORY (location QR)" is satisfied via
 * QrTargetsRepository/QrPublicRepository reading the shared `product_variants`/`products`/
 * `locations` tables directly, the same convention inventory/repositories/
 * product-variants-lookup.repository.ts already established for the identical INVENTORY-->CATALOG
 * edge — not by importing CatalogModule/InventoryModule's own repository classes. "Consumed by:
 * nothing depends on QR — it is a leaf module," so nothing else imports QrModule.
 *
 * ThrottlerModule.forRoot here is scoped to this module's own QrPublicThrottlerGuard, same pattern
 * as auth/auth.module.ts's AuthThrottlerGuard — a second, independent Throttler configuration, not
 * a shared/global one (the public QR resolver's traffic shape — one IP scanning many different
 * codes — is unrelated to login's IP+email brute-force shape).
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: Number(getOptionalEnvVar('QR_PUBLIC_RATE_LIMIT_TTL_SECONDS', '60')) * 1000,
        limit: Number(getOptionalEnvVar('QR_PUBLIC_RATE_LIMIT_MAX', '30')),
      },
    ]),
  ],
  controllers: [QrCodesController, QrPublicController],
  providers: [QrCodesService, QrPublicService, AuditLogService, QrCodesRepository, QrTargetsRepository, QrPublicRepository],
})
export class QrModule {}
