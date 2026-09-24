import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { KardexQueryDto } from './kardex-query.dto';

export const KARDEX_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;

/** Same filters as `GET /reports/kardex` — the export must contain exactly the filtered set the
 * screen shows (UI-UX-SPEC-001 §19), so this extends rather than redeclares them. */
export class KardexExportQueryDto extends KardexQueryDto {
  @ApiProperty({ enum: KARDEX_EXPORT_FORMATS })
  @IsIn(KARDEX_EXPORT_FORMATS)
  format!: (typeof KARDEX_EXPORT_FORMATS)[number];
}
