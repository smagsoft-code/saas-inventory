import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

const DUPLICATE_HANDLING_MODES = ['update_catalog_only', 'update_catalog_and_inventory', 'skip_existing', 'reject_on_duplicate'] as const;

/** §9/§16 — either `mappingTemplateId` (reuse a saved template) or an inline `columnMapping` is
 * supplied; ImportMappingService requires exactly one. Both `defaultLocationId` and
 * `duplicateHandlingMode` (default `update_catalog_only`, §16's mandated safe default) are set here
 * too, since they are frozen onto `import_jobs` alongside the mapping. */
export class SetMappingDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  mappingTemplateId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  defaultLocationId?: string;

  @ApiPropertyOptional({ enum: DUPLICATE_HANDLING_MODES })
  @IsOptional()
  @IsIn(DUPLICATE_HANDLING_MODES)
  duplicateHandlingMode?: (typeof DUPLICATE_HANDLING_MODES)[number];
}

export { DUPLICATE_HANDLING_MODES };
