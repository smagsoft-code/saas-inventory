import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Creates the caller's open cart. `locationId` is where the sale is made from (schema:
 * `carts.location_id` is NOT NULL) — validated for existence and for the caller's
 * location authorization (ADR-0024). No `userId`/`status`/`version` — userId is always the
 * authenticated actor, a cart always starts `open`. If the caller already has an open cart, that
 * one is returned instead (get-or-create). */
export class CreateCartDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'An existing location id in the current tenant.' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'An existing customer id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
