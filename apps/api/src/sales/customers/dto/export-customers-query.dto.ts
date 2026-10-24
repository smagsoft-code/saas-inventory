import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { EXPORT_FORMATS, type ExportFormat } from '../../../common/export/tabular-export.service';
import { ListCustomersQueryDto } from './list-customers-query.dto';

/** Same filters as `GET /customers` (`page`/`pageSize` accepted and ignored). */
export class ExportCustomersQueryDto extends ListCustomersQueryDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;
}
