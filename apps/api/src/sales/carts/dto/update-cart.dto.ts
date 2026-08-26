import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Updates the caller's open cart header — the customer being sold to, or the location the sale is
 * made from. Both re-validated (existence, tenant scope, and for `locationId` the caller's
 * ADR-0024 authorization) by the service. */
export class UpdateCartDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
