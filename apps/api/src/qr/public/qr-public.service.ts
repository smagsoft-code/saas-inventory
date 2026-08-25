import { Injectable, NotFoundException } from '@nestjs/common';
import { QrPublicRepository } from './qr-public.repository';
import type { QrPublicResponseDto } from './dto/qr-public-response.dto';

/**
 * `GET /q/:code` (api.md#public-endpoints). One generic 404 ("QR code not found") for every failure
 * shape — code doesn't exist, revoked, expired (all three already collapsed into "no visible row" by
 * the `qr_codes_public_resolve` RLS policy), orphaned/soft-deleted target (no visible row under the
 * `*_public_resolve` policies added in migration 0018) — never a distinguishable error, so a caller
 * probing codes learns nothing about which failure mode occurred (security.md's "avoid revealing
 * internal state" guidance, same posture as JwtAuthGuard's single generic invalid-session message).
 */
@Injectable()
export class QrPublicService {
  constructor(private readonly qrPublicRepository: QrPublicRepository) {}

  async resolve(code: string): Promise<QrPublicResponseDto> {
    const qr = await this.qrPublicRepository.findActiveByCode(code);
    if (!qr) {
      throw new NotFoundException('QR code not found.');
    }

    if (qr.targetType === 'product_variant') {
      const variant = await this.qrPublicRepository.findProductVariant(qr.targetId);
      if (!variant) {
        throw new NotFoundException('QR code not found.');
      }
      const productName = await this.qrPublicRepository.findProductName(variant.productId);
      if (productName === undefined) {
        throw new NotFoundException('QR code not found.');
      }
      return {
        targetType: 'product_variant',
        productName,
        maxPrice: Number(variant.maxPrice),
        status: variant.status,
      };
    }

    const location = await this.qrPublicRepository.findLocation(qr.targetId);
    if (!location) {
      throw new NotFoundException('QR code not found.');
    }
    return {
      targetType: 'location',
      name: location.name,
      code: location.code,
      status: location.status,
    };
  }
}
