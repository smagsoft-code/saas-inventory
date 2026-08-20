import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

const CATEGORY_STATUSES = ['active', 'inactive'] as const;

export class UpdateCategoryDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be lowercase, alphanumeric, and hyphen-separated.' })
  @Length(2, 120)
  slug?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant, or omit to leave unchanged.' })
  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;

  @ApiPropertyOptional({ enum: CATEGORY_STATUSES })
  @IsOptional()
  @IsIn(CATEGORY_STATUSES)
  status?: (typeof CATEGORY_STATUSES)[number];
}
