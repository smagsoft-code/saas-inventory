import { ApiProperty } from '@nestjs/swagger';

/** GET/PATCH /tenant's response shape — only the fields §8 identifies as safe/meaningful to
 * expose to a tenant user: no infrastructure/internal-audit fields exist on `tenants` beyond what's
 * here. `status`/`isDemo` are read-only (never accepted by UpdateTenantDto) — see §9. */
export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'The slug required to log back in — see LoginDto.tenantSlug.' })
  slug!: string;

  @ApiProperty({ enum: ['active', 'suspended', 'archived'], description: 'Platform-managed — never settable by a tenant user.' })
  status!: string;

  @ApiProperty()
  isDemo!: boolean;

  @ApiProperty()
  createdAt!: string;
}
