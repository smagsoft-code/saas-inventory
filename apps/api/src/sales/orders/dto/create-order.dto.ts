import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

const DOCUMENT_TYPES = ['invoice', 'sales_note'] as const;

/** Checkout: turns the caller's open cart into an order. `documentType` is the customer's choice —
 * `invoice` (factura) or `sales_note` (nota de venta), the exact `orders.document_type` enum
 * (ADR-0023, §32). The platform never issues the fiscal document itself (§33) — for an `invoice`
 * the order just records `invoice_status = 'pending'` for a later external process.
 *
 * No `customerId`/`locationId`/`sellerId`/`total`/`status`/`customerSnapshot` — all derived
 * server-side (§83-§87): the customer and location come from the cart, the seller is the
 * authenticated actor, totals are computed from validated prices, the snapshot is built from the
 * validated customer row. */
export class CreateOrderDto {
  @ApiProperty({ type: String, format: 'uuid', description: "The caller's open cart id." })
  @IsUUID()
  cartId!: string;

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType!: (typeof DOCUMENT_TYPES)[number];
}
