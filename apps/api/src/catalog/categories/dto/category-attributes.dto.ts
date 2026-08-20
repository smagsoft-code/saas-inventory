import { ApiProperty, ApiPropertyOptional, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class CategoryAttributeEntryDto {
  @ApiProperty({ type: String, description: 'An attribute_definitions id in the current tenant.' })
  @IsUUID()
  attributeDefinitionId!: string;

  @ApiPropertyOptional({ type: Boolean, description: 'NULL/omitted = inherit attribute_definitions.isRequiredDefault.' })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

/** PUT semantics — replaces the category's complete attribute-assignment set, matching
 * AttributesRepository.replaceCategoryAttributes(). */
@ApiExtraModels(CategoryAttributeEntryDto)
export class SetCategoryAttributesDto {
  @ApiProperty({ type: 'array', items: { $ref: getSchemaPath(CategoryAttributeEntryDto) } })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CategoryAttributeEntryDto)
  entries!: CategoryAttributeEntryDto[];
}

export class CategoryAttributeResponseDto {
  @ApiProperty({ type: String })
  attributeDefinitionId!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  dataType!: string;

  @ApiProperty({ type: Boolean })
  isRequired!: boolean;

  @ApiProperty({ type: Number })
  displayOrder!: number;
}
