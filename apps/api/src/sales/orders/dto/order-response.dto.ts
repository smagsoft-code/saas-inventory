import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderCustomerSnapshotDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  taxId?: string;

  @ApiPropertyOptional({ type: String })
  email?: string;

  @ApiPropertyOptional({ type: String })
  phone?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  address?: Record<string, unknown>;
}

export class OrderItemResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  productVariantId!: string;

  @ApiProperty({ type: String })
  sku!: string;

  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number, description: 'The negotiated/final unit price actually charged (frozen).' })
  unitPrice!: number;

  @ApiProperty({ type: Number, description: 'The variant max (reference) price at the moment of sale (frozen).' })
  maxPrice!: number;

  @ApiProperty({ type: Number, description: 'The variant base price at the moment of sale (frozen).' })
  basePrice!: number;

  @ApiPropertyOptional({ type: Number, description: 'The variant floor price at the moment of sale (frozen) — present only for callers with pricing.floor.view.' })
  minPrice?: number;

  @ApiProperty({ type: Number, description: '(maxPrice - unitPrice) * quantity — informational.' })
  discountAmount!: number;

  @ApiProperty({
    type: Boolean,
    description:
      'true when unitPrice is below the variant base_price at the moment of sale — the order cannot be confirmed until a price_approvals request for this line is approved (FASE 13).',
  })
  isExceptionalDiscount!: boolean;

  @ApiProperty({ type: Number, description: 'unitPrice * quantity.' })
  lineTotal!: number;
}

export class OrderPaymentResponseDto {
  @ApiProperty({ enum: ['cash', 'transfer', 'card', 'other'] })
  paymentMethod!: string;

  @ApiProperty({ type: Number })
  amount!: number;
}

export class OrderResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  orderNumber!: string;

  @ApiProperty({ enum: ['draft', 'pending', 'confirmed', 'fulfilled', 'cancelled'] })
  status!: string;

  @ApiProperty({ enum: ['invoice', 'sales_note'] })
  documentType!: string;

  @ApiPropertyOptional({ enum: ['pending', 'issued', 'failed'], description: 'External invoicing status — only present for invoice orders.' })
  invoiceStatus?: string;

  @ApiProperty({ type: String, format: 'uuid' })
  locationId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Traceability link — display always uses the frozen snapshot below.' })
  customerId?: string;

  @ApiProperty({ type: OrderCustomerSnapshotDto })
  customer!: OrderCustomerSnapshotDto;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: [OrderPaymentResponseDto] })
  payments!: OrderPaymentResponseDto[];

  @ApiProperty({ type: Number })
  subtotal!: number;

  @ApiProperty({ type: Number, description: 'Sum of line discountAmount — informational, not re-subtracted from total.' })
  discountTotal!: number;

  @ApiProperty({ type: Number, description: 'Always 0 in this phase — no tax engine (§31).' })
  taxTotal!: number;

  @ApiProperty({ type: Number, description: 'subtotal + taxTotal.' })
  total!: number;

  @ApiProperty({ type: String, description: 'ISO 4217.' })
  currency!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  placedByUserId?: string;

  @ApiPropertyOptional({ type: String, description: 'Seller (creator) display name. Only on GET /orders (list).' })
  placedByName?: string;

  @ApiPropertyOptional({
    enum: ['none', 'pending', 'delivered', 'failed'],
    description: 'Rolled-up event_outbox delivery status of the order events. Only on GET /orders (list).',
  })
  notificationStatus?: 'none' | 'pending' | 'delivered' | 'failed';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
