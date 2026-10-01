import { ApiProperty } from '@nestjs/swagger';

export class ProductInStockResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;
}
