import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

const WAREHOUSE_STATUSES = ['active', 'inactive'] as const;

export class UpdateWarehouseDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9](-?[A-Z0-9]+)*$/, { message: 'code must be uppercase alphanumeric, optionally hyphen-separated.' })
  @Length(1, 40)
  code?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: (typeof WAREHOUSE_STATUSES)[number];
}
