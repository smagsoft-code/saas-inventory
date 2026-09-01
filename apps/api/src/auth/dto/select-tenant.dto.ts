import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Second step of a multi-membership login (016-C). `tenantId` names the company the caller picked
 * from the `availableTenants` list `POST /auth/login` returned — it is never trusted on its own:
 * the backend re-verifies, against the identity carried by the selection token, that a matching
 * `active` membership (and tenant, and identity, and user) exists before issuing the real access
 * token.
 *
 * The selection token normally travels in the httpOnly `tenant_selection` cookie (web); the
 * optional body field is the fallback for non-browser callers, mirroring `RefreshDto.refreshToken`.
 */
export class SelectTenantDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'One of the tenantId values returned by POST /auth/login.' })
  @IsUUID()
  tenantId!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  selectionToken?: string;
}
