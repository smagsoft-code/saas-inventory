import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /q/:code` — the unauthenticated public resolver (api.md#public-endpoints,
 * database.md#qr-codes). Built by inclusion, never a `{...row}` spread (same discipline as
 * ADR-0028's authenticated DTOs, even though this path has no permission matrix to apply — the
 * Postgres column-level GRANT is what actually makes `basePrice`/`minPrice`/`cost` structurally
 * unreachable here, see qr-public.repository.ts). No `id`, no `tenantId`, no `code`, no `sku` — none
 * of those are even fetchable (the GRANTs restricting `app_public_resolver` never include them,
 * migrations 0003/0018), and api.md is explicit this route "does not leak which tenant owns the
 * scanned code beyond what's intentionally public."
 */
export class QrPublicProductDto {
  @ApiProperty({ enum: ['product_variant'] })
  targetType!: 'product_variant';

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: Number, description: 'The reference/list price — never basePrice, minPrice or cost.' })
  maxPrice!: number;

  @ApiProperty({ enum: ['active', 'discontinued'] })
  status!: string;
}

export class QrPublicLocationDto {
  @ApiProperty({ enum: ['location'] })
  targetType!: 'location';

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;
}

export type QrPublicResponseDto = QrPublicProductDto | QrPublicLocationDto;
