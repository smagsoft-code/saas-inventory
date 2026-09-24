import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KardexBalanceDto {
  @ApiProperty({ type: Number })
  stockUnits!: number;

  @ApiPropertyOptional({ type: Number, description: 'Omitted (not just null) when the caller lacks pricing.cost.view.' })
  averageCost?: number;

  @ApiPropertyOptional({ type: Number })
  stockValue?: number;

  @ApiPropertyOptional({ type: Boolean, description: 'True if this balance rests on at least one cost that had to be estimated (no per-movement unit cost recorded).' })
  estimated?: boolean;
}

export class KardexRowDto {
  @ApiProperty({ type: String, format: 'uuid' })
  movementId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String })
  movementType!: string;

  @ApiProperty({ type: String, description: 'Human-readable label, e.g. "Venta #ORD-000123", "Transferencia #a1b2c3d4", "Ajuste: conteo físico".' })
  label!: string;

  @ApiProperty({ type: Number })
  entrada!: number;

  @ApiProperty({ type: Number })
  salida!: number;

  @ApiPropertyOptional({ type: Number })
  unitCost?: number;

  @ApiPropertyOptional({ type: Boolean })
  unitCostEstimated?: boolean;

  @ApiPropertyOptional({ type: Number })
  averageCostAfter?: number;

  @ApiProperty({ type: Number })
  stockAfter!: number;

  @ApiPropertyOptional({ type: Number })
  stockValueAfter?: number;
}

export class KardexLocationBalanceDto {
  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: String })
  locationName!: string;

  @ApiProperty({ type: String })
  warehouseName!: string;

  @ApiProperty({ type: Number })
  stockPhysical!: number;

  @ApiPropertyOptional({ type: Number })
  stockAvailable?: number;
}

export class KardexResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: String, format: 'uuid', description: 'The parent product id — lets a caller that fetched several variants (e.g. the "Ver todos" tenant-wide feed) jump straight to this product\'s own variant picker without a second lookup.' })
  productId!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: String })
  sku!: string;

  @ApiProperty({ type: KardexBalanceDto, description: 'Balance as of just before `from` (or the very beginning of history if `from` is omitted).' })
  opening!: KardexBalanceDto;

  @ApiProperty({ type: KardexRowDto, isArray: true })
  rows!: KardexRowDto[];

  @ApiProperty({ type: KardexBalanceDto, description: 'Balance as of the last row returned (or `opening` again if there are none).' })
  closing!: KardexBalanceDto;

  @ApiProperty({ type: Boolean, description: 'True when the range held more movements than the hard cap and was truncated — narrow the date range to see the rest.' })
  truncated!: boolean;

  @ApiProperty({ type: KardexLocationBalanceDto, isArray: true, description: '"Stock por sucursal" — this variant\'s current balance at every location it has one, tenant-wide (not limited to the queried location).' })
  stockByLocation!: KardexLocationBalanceDto[];
}
