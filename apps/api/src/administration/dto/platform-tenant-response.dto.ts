import { ApiProperty } from '@nestjs/swagger';

/** SuperAdmin's view of a tenant — the full `tenants` row, including the fields a tenant's own
 * `GET /tenant` deliberately omits editing (`slug`/`status`/`isDemo` — Prompt 05-A's "system/
 * administrative fields with no endpoint exposing them for tenant self-edit"). Read-only fields
 * here are exactly those; `status` changes only via the dedicated suspend/activate actions. */
export class PlatformTenantResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String, enum: ['active', 'suspended', 'archived'] })
  status!: string;

  @ApiProperty({ type: Boolean })
  isDemo!: boolean;

  @ApiProperty({ type: String })
  createdAt!: string;
}
