import { ApiProperty } from '@nestjs/swagger';

/** §14 — the preview summary, backed by `import_jobs`'s own maintained counters (incremental,
 * never a full-table-scan aggregate — database.md#preview) plus a live per-status breakdown from
 * `import_job_rows` (cheap, index-backed `GROUP BY`). */
export class ImportPreviewResponseDto {
  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: Number })
  totalRows!: number;

  @ApiProperty({ type: Number })
  validRows!: number;

  @ApiProperty({ type: Number })
  invalidRows!: number;

  @ApiProperty({ type: Number })
  warningRows!: number;

  @ApiProperty({ type: Number })
  importedRows!: number;

  @ApiProperty({ type: Number })
  pendingRows!: number;

  @ApiProperty({ type: Number })
  skippedRows!: number;

  @ApiProperty({ type: Number, description: 'Rows whose match_action would create a new product.' })
  newProducts!: number;

  @ApiProperty({ type: Number, description: 'Rows whose match_action would update an existing product/variant.' })
  existingProducts!: number;
}
