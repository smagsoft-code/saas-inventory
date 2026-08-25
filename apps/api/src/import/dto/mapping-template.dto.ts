import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** `columnMapping` is a dynamic `{ excelHeader: targetField }` map (§9) — validated for shape here
 * (IsObject) and for known-target-field content in ImportMappingService, the same split
 * CreateProductDto's `attributes: Record<string, unknown>` uses with AttributeValidationService. No
 * `tenantId`/`createdBy` field — mass-assignment posture identical to every other create DTO. */
export class CreateMappingTemplateDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ type: Object, description: 'Excel header -> target field (standard field name or "attr:<code>").' })
  @IsObject()
  columnMapping!: Record<string, string>;
}

export class UpdateMappingTemplateDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;
}

export class MappingTemplateResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  categoryId?: string | undefined;

  @ApiProperty({ type: Object })
  columnMapping!: Record<string, string>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
