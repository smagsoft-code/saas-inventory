import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsTaxIdForType } from './tax-id-format.validator';

const CUSTOMER_TYPES = ['cedula', 'ruc', 'pasaporte'] as const;
const CUSTOMER_STATUSES = ['active', 'inactive'] as const;

/** Partial update — every field optional. `status` uses the schema's `('active','inactive')` enum
 * (database.md#soft-delete-policy: no physical delete; `deleted_at` is set only by an explicit
 * archive path, not exposed here). Editing a customer NEVER changes any historical order's frozen
 * `customer_*_snapshot` (§13/§14). `taxId`'s format is only re-checked against `type` when BOTH are
 * present in the same patch — a lone `taxId` edit can't be validated against a `type` the caller
 * isn't sending. */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: (typeof CUSTOMER_TYPES)[number];

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @IsTaxIdForType()
  taxId?: string;

  @ApiPropertyOptional({ type: String, maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @Length(1, 254)
  email?: string;

  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string;

  @ApiPropertyOptional({ type: String, maxLength: 400 })
  @IsOptional()
  @IsString()
  @Length(0, 400)
  address?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: (typeof CUSTOMER_STATUSES)[number];
}
