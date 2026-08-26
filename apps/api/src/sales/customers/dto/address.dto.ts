import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** `customers.address` / `orders.customer_address_snapshot` are `jsonb` in the approved schema
 * (database.md#customers-and-suppliers, database.md#orders) — a small, explicit, validated set of
 * fields rather than a free-form passthrough object, so what a historical order froze stays a known
 * shape. All fields optional; an `invoice`-type order additionally requires the object to be
 * present and non-empty (checked in OrdersService). */
export class AddressDto {
  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  line1?: string;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  line2?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  city?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  state?: string;

  @ApiPropertyOptional({ type: String, maxLength: 30 })
  @IsOptional()
  @IsString()
  @Length(0, 30)
  postalCode?: string;

  @ApiPropertyOptional({ type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  country?: string;
}
