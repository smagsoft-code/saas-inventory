import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

const LOCATION_STATUSES = ['active', 'inactive'] as const;

/** No `warehouseId` field — moving a location to a different warehouse is a structural change
 * outside this endpoint's scope; only reparenting within the same warehouse is supported (the
 * service layer validates the new parent belongs to the location's current warehouse). */
export class UpdateLocationDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9](-?[A-Z0-9]+)*$/, { message: 'code must be uppercase alphanumeric, optionally hyphen-separated.' })
  @Length(1, 40)
  code?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing location id in the same warehouse, or omit to leave unchanged.' })
  @IsOptional()
  @IsUUID()
  parentLocationId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional({ enum: LOCATION_STATUSES })
  @IsOptional()
  @IsIn(LOCATION_STATUSES)
  status?: (typeof LOCATION_STATUSES)[number];
}
