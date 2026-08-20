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

  @ApiProperty({ type: String, minLength: 2, maxLength: 120, description: 'URL-safe, unique within the tenant.' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug must be lowercase, alphanumeric, and hyphen-separated.' })
  @Length(2, 120)
  slug!: string;

  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;
}
