import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentReturnInfoDto {
  @ApiProperty({ type: Number, description: 'Non-cancelled sales returns against the payment\'s order.' })
  count!: number;

  @ApiProperty({ type: [String], description: 'Return numbers (DEV-…).' })
  numbers!: string[];

  @ApiProperty({ type: Number, description: 'Σ quantity returned × frozen unit price, over those returns.' })
  returnedValue!: number;
}

export class PaymentRowDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'order_payments.created_at — when the payment was recorded (order confirmation).' })
  paidAt!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String })
  orderNumber!: string;

  @ApiProperty({ type: String, description: 'Frozen customer name of the order.' })
  customerName!: string;

  @ApiProperty({ enum: ['cash', 'transfer', 'card', 'other'] })
  paymentMethod!: string;

  @ApiProperty({ type: Number })
  amount!: number;

  @ApiPropertyOptional({ type: String })
  sellerName?: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: String, description: '"Sucursal · Almacén".' })
  locationLabel!: string;

  @ApiProperty({ enum: ['invoice', 'sales_note'] })
  documentType!: string;

  @ApiPropertyOptional({ type: PaymentReturnInfoDto, description: 'Present only when the order has at least one non-cancelled return.' })
  returns?: PaymentReturnInfoDto;
}

export class PaymentMethodTotalDto {
  @ApiProperty({ enum: ['cash', 'transfer', 'card', 'other'] })
  paymentMethod!: string;

  @ApiProperty({ type: Number })
  paymentCount!: number;

  @ApiProperty({ type: Number })
  amount!: number;
}

export class PaymentsTotalsDto {
  @ApiProperty({ type: Number })
  paymentCount!: number;

  @ApiProperty({ type: Number })
  amount!: number;

  @ApiProperty({ type: [PaymentMethodTotalDto] })
  byMethod!: PaymentMethodTotalDto[];
}

export class PaymentsReportMetaDto {
  @ApiProperty({ type: Number })
  page!: number;

  @ApiProperty({ type: Number })
  pageSize!: number;

  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  totalPages!: number;
}

export class PaymentsReportResponseDto {
  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: String })
  currency!: string;

  @ApiProperty({ type: PaymentsTotalsDto, description: 'Over the whole filtered set, not just the page.' })
  totals!: PaymentsTotalsDto;

  @ApiProperty({ type: [PaymentRowDto] })
  data!: PaymentRowDto[];

  @ApiProperty({ type: PaymentsReportMetaDto })
  meta!: PaymentsReportMetaDto;
}
