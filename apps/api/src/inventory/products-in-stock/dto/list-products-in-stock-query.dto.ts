import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ListProductsInStockQueryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  locationId!: string;
}
