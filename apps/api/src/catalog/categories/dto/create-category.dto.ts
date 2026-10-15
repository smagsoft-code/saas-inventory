import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** No `tenantId`/`status` field, deliberately — tenant is always CurrentTenant, and a new category
 * always starts `active` (the column default) per the same mass-assignment posture as
 * core/users/dto/create-user.dto.ts. `parentCategoryId`, when given, is validated against the same
 * tenant by the service layer (a client-supplied id from another tenant simply resolves as not
 * found, same posture as roleId in core/users). */
export class CreateCategoryDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 2,
    maxLength: 60,
    example: 'CAT-001',
    description:
      'Category code, unique within the tenant (case-insensitive). Letters (any case), digits and hyphens. Omit it to get the next automatic one (CAT-001, CAT-002, …).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/, { message: 'code must be letters, digits and hyphens (no spaces, no leading/trailing hyphen).' })
  @Length(2, 60)
  code?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;
}
