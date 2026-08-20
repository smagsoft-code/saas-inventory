import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** No `tenantId`/`status` field, deliberately — tenant is always CurrentTenant, and a new location
 * always starts `active` (the column default), same mass-assignment posture as
 * catalog/categories/dto/create-category.dto.ts. `warehouseId`/`parentLocationId`, when given, are
 * validated against the same tenant by the service layer (a client-supplied id from another tenant
 * simply resolves as not found). */
export class CreateLocationDto {
  @ApiProperty({ type: String, description: 'An existing warehouse id in the current tenant.' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ type: String, description: 'An existing location id in the same warehouse.' })
  @IsOptional()
  @IsUUID()
  parentLocationId?: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 40, description: 'Unique within the warehouse.' })
  @IsString()
  @Matches(/^[A-Z0-9](-?[A-Z0-9]+)*$/, { message: 'code must be uppercase alphanumeric, optionally hyphen-separated.' })
  @Length(1, 40)
  code!: string;

  @ApiPropertyOptional({ type: Boolean, default: true, description: 'false for quarantine/damaged/scrap locations.' })
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;
}
