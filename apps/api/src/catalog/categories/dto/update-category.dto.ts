import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

const CATEGORY_STATUSES = ['active', 'inactive'] as const;

export class UpdateCategoryDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 60, example: 'CAT-001' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/, { message: 'code must be letters, digits and hyphens (no spaces, no leading/trailing hyphen).' })
  @Length(2, 60)
  code?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant, or omit to leave unchanged.' })
  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;

  @ApiPropertyOptional({ enum: CATEGORY_STATUSES })
  @IsOptional()
  @IsIn(CATEGORY_STATUSES)
  status?: (typeof CATEGORY_STATUSES)[number];
}
