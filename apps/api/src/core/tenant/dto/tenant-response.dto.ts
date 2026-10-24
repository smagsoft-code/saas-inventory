import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** GET/PATCH /tenant's response shape — only the fields §8 identifies as safe/meaningful to
 * expose to a tenant user: no infrastructure/internal-audit fields exist on `tenants` beyond what's
 * here. `status`/`isDemo` are read-only (never accepted by UpdateTenantDto) — see §9. */
export class TenantResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, description: 'The slug required to log back in — see LoginDto.tenantSlug.' })
  slug!: string;

  @ApiProperty({ enum: ['active', 'suspended', 'archived'], description: 'Platform-managed — never settable by a tenant user.' })
  status!: string;

  @ApiProperty({ type: Boolean })
  isDemo!: boolean;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiPropertyOptional({ type: Number, description: 'Present only when the company has a logo: its last change in ms — the cache-buster for GET /tenant/logo.' })
  logoVersion?: number;
}
