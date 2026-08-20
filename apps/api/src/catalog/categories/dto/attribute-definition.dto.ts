import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const ATTRIBUTE_DATA_TYPES = ['text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select'] as const;
export const ATTRIBUTE_SCOPES = ['product', 'variant'] as const;
const ATTRIBUTE_STATUSES = ['active', 'inactive'] as const;

/** No `tenantId` field — always CurrentTenant. `appliesTo` is intrinsic and never changed after
 * creation (database.md: "not overridable per category... kept single-valued"), so it exists only
 * on create, never on update. */
export class CreateAttributeDefinitionDto {
  @ApiProperty({ type: String, description: 'Stable JSONB key, e.g. "cilindraje", "color".' })
  @IsString()
  @Length(1, 60)
  code!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ATTRIBUTE_DATA_TYPES })
  @IsIn(ATTRIBUTE_DATA_TYPES)
  dataType!: (typeof ATTRIBUTE_DATA_TYPES)[number];

  @ApiProperty({ enum: ATTRIBUTE_SCOPES })
  @IsIn(ATTRIBUTE_SCOPES)
  appliesTo!: (typeof ATTRIBUTE_SCOPES)[number];

  @ApiPropertyOptional({ type: String, description: 'A measurement_units id — number/decimal attributes only.' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  isRequiredDefault?: boolean;

  @ApiPropertyOptional({ type: Number, description: 'number/decimal attributes only.' })
  @IsOptional()
  @IsNumber()
  minValue?: number;

  @ApiPropertyOptional({ type: Number, description: 'number/decimal attributes only.' })
  @IsOptional()
  @IsNumber()
  maxValue?: number;
}

export class UpdateAttributeDefinitionDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  isRequiredDefault?: boolean;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  minValue?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @ApiPropertyOptional({ enum: ATTRIBUTE_STATUSES })
  @IsOptional()
  @IsIn(ATTRIBUTE_STATUSES)
  status?: (typeof ATTRIBUTE_STATUSES)[number];
}

export class AttributeDefinitionResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  description?: string | undefined;

  @ApiProperty({ enum: ATTRIBUTE_DATA_TYPES })
  dataType!: string;

  @ApiProperty({ enum: ATTRIBUTE_SCOPES })
  appliesTo!: string;

  @ApiPropertyOptional({ type: String })
  unitId?: string | undefined;

  @ApiProperty({ type: Boolean })
  isRequiredDefault!: boolean;

  @ApiPropertyOptional({ type: Number })
  minValue?: number | undefined;

  @ApiPropertyOptional({ type: Number })
  maxValue?: number | undefined;

  @ApiProperty({ enum: ATTRIBUTE_STATUSES })
  status!: string;
}
