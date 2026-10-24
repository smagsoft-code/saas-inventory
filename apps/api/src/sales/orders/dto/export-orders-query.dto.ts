import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { EXPORT_FORMATS, type ExportFormat } from '../../../common/export/tabular-export.service';
import { ListOrdersQueryDto } from './list-orders-query.dto';

/** Same filters/sort as `GET /orders` — the export contains exactly the filtered set the screen
 * shows (`page`/`pageSize` are accepted and ignored: an export is never one page). */
export class ExportOrdersQueryDto extends ListOrdersQueryDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;
}
