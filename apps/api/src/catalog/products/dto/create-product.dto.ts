import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';
import { VariantFieldsDto } from './variant-fields.dto';

/** No `tenantId`/`status` field, deliberately — tenant is always CurrentTenant, and a new product
 * always starts `active` (set by `ProductsService.create`; change it later via PATCH), matching core/users/dto/create-user.dto.ts's
 * mass-assignment posture. `categoryId`/`brandId`/`supplierId`, when given, are validated against
 * the same tenant by the service layer. `defaultVariant` is mandatory — ADR-0017: "every product has
 * at least one variant... application logic always creates a single default variant alongside the
 * product." */
export class CreateProductDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing category id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing brand id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ type: String, description: 'An existing supplier id in the current tenant.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'PRODUCT-scope dynamic attributes, validated against categoryId (§33).',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiProperty({ type: VariantFieldsDto })
  @ValidateNested()
  @Type(() => VariantFieldsDto)
  defaultVariant!: VariantFieldsDto;
}
