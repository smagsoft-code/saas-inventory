import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

/** No `tenantId`/`status` field, deliberately — tenant is always CurrentTenant, and a new
 * warehouse always starts `active` (the column default), same mass-assignment posture as
 * catalog/categories/dto/create-category.dto.ts. Creating a warehouse also creates its default
 * "General" location in the same transaction — database.md#inventory-warehouses-locations-balance-ledger's
 * "every warehouse always has at least one location" invariant — the caller does not provide it. */
export class CreateWarehouseDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 40, description: 'Unique within the tenant.' })
  @IsString()
  @Matches(/^[A-Z0-9](-?[A-Z0-9]+)*$/, { message: 'code must be uppercase alphanumeric, optionally hyphen-separated.' })
  @Length(1, 40)
  code!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}
