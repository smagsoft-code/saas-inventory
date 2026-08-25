import { ApiProperty } from '@nestjs/swagger';

/** quantityAvailable is a Postgres GENERATED ALWAYS AS column (physical - reserved - committed) —
 * never written by application code, always read back from the database. */
export class BalanceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: Number })
  quantityPhysical!: number;

  @ApiProperty({ type: Number })
  quantityReserved!: number;

  @ApiProperty({ type: Number })
  quantityCommitted!: number;

  @ApiProperty({ type: Number })
  quantityAvailable!: number;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
