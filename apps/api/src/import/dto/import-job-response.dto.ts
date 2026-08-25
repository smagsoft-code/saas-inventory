import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportJobResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String })
  originalFilename!: string;

  @ApiProperty({ type: String })
  duplicateHandlingMode!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  defaultLocationId?: string | undefined;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  mappingTemplateId?: string | undefined;

  @ApiProperty({ type: Object })
  columnMapping!: Record<string, string>;

  @ApiPropertyOptional({ type: Number })
  totalRows?: number | undefined;

  @ApiPropertyOptional({ type: Number })
  validRows?: number | undefined;

  @ApiPropertyOptional({ type: Number })
  invalidRows?: number | undefined;

  @ApiPropertyOptional({ type: Number })
  warningRows?: number | undefined;

  @ApiPropertyOptional({ type: Number })
  importedRows?: number | undefined;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  startedAt?: string | undefined;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  completedAt?: string | undefined;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
