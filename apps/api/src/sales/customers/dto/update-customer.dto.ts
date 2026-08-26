import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AddressDto } from './address.dto';

const CUSTOMER_TYPES = ['individual', 'business'] as const;
const CUSTOMER_STATUSES = ['active', 'inactive'] as const;

/** Partial update — every field optional. `status` uses the schema's `('active','inactive')` enum
 * (database.md#soft-delete-policy: no physical delete; `deleted_at` is set only by an explicit
 * archive path, not exposed here). Editing a customer NEVER changes any historical order's frozen
 * `customer_*_snapshot` (§13/§14). */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: (typeof CUSTOMER_TYPES)[number];

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  displayName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(1, 50)
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

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ enum: CUSTOMER_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: (typeof CUSTOMER_STATUSES)[number];

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
