import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportRowIssueDto {
  @ApiProperty({ type: String })
  field!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  message!: string;
}

export class ImportJobRowResponseDto {
  @ApiProperty({ type: Number })
  rowNumber!: number;

  @ApiProperty({ type: String })
  status!: string;

  @ApiPropertyOptional({ type: String })
  matchAction?: string | undefined;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  matchedProductVariantId?: string | undefined;

  @ApiProperty({ type: Object })
  rawData!: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  mappedData?: Record<string, unknown> | undefined;

  @ApiProperty({ type: ImportRowIssueDto, isArray: true })
  errors!: ImportRowIssueDto[];

  @ApiProperty({ type: ImportRowIssueDto, isArray: true })
  warnings!: ImportRowIssueDto[];
}
