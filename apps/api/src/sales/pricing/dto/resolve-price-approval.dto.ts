import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive } from 'class-validator';

/** `POST /price-approvals/:id/approve` body — owner redesign. `price` is optional: when present
 * and different from the line's current price, the approver is editing it (not just accepting
 * the amount the seller originally requested) — the edited price is validated the same way
 * checkout validates a negotiated price (max price ceiling, tenant hard floor) and becomes the
 * order line's new frozen price in the same transaction that approves the request. Omit to
 * approve the price exactly as requested, unchanged. Never used by `reject` — there is nothing to
 * edit on a request being turned down. */
export class ResolvePriceApprovalDto {
  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;
}
