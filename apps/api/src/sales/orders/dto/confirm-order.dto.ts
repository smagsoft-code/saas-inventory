import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsIn, IsNumber, IsPositive, ValidateNested } from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const;

/** One payment method's amount within a split payment (owner redesign). `amount` is validated
 * against the order total in `OrdersService.confirm` — never here, since this DTO alone can't see
 * the order's own total. */
export class CreateOrderPaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiProperty({ type: Number })
  @IsNumber()
  @IsPositive()
  amount!: number;
}

/** `POST /orders/:id/confirm` body — the owner's split-payment redesign. `payments` is one or
 * more `{ paymentMethod, amount }` entries whose amounts must sum exactly to the order total
 * (checked server-side, `BadRequest` on mismatch — §39-style invariant, since no CHECK constraint
 * can reach across `order_payments` rows). Asked here rather than at `POST /orders` because
 * confirming is the actual commit boundary (§16/§53) — the moment money changes hands — and
 * because an order with a still-unapproved exceptional-discount line can't be confirmed at all
 * (`assertExceptionalDiscountsApproved`), so there's nothing to usefully pick a payment method
 * for until that clears. */
export class ConfirmOrderDto {
  @ApiProperty({ type: [CreateOrderPaymentDto] })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderPaymentDto)
  @ArrayMinSize(1)
  payments!: CreateOrderPaymentDto[];
}
