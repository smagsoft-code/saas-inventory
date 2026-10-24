import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { EXPORT_FORMATS, type ExportFormat } from '../../../common/export/tabular-export.service';
import { ProductCatalogQueryDto } from './product-catalog-query.dto';

/** Same filters as `GET /reports/product-catalog` (`page`/`pageSize` accepted and ignored). */
export class ProductCatalogExportQueryDto extends ProductCatalogQueryDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;
}
