import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { EXPORT_FORMATS, type ExportFormat } from '../../../common/export/tabular-export.service';
import { ListTransfersQueryDto } from './list-transfers-query.dto';

/** Same filters as `GET /inventory/transfers` (`page`/`pageSize` accepted and ignored). */
export class ExportTransfersQueryDto extends ListTransfersQueryDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;
}
