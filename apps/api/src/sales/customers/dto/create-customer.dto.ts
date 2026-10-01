import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsTaxIdForType } from './tax-id-format.validator';

const CUSTOMER_TYPES = ['cedula', 'ruc', 'pasaporte'] as const;

/** No `tenantId`/`status` field — tenant is always CurrentTenant, and a customer always starts
 * `active` (the column default). Owner redesign: `type` is the identification document itself
 * (cedula/ruc/pasaporte, replacing the old individual/business distinction); `taxId` is that
 * document's number, required, format-checked against `type` (`IsTaxIdForType`), and unique per
 * tenant when present (`customers_tenant_id_tax_id_key` partial index), never globally. `address`
 * is one free-form line (no structured sub-fields) — `orders.customer_address_snapshot` is a
 * separate, historical column and keeps its own shape. */
export class CreateCustomerDto {
  @ApiProperty({ enum: CUSTOMER_TYPES })
  @IsIn(CUSTOMER_TYPES)
  type!: (typeof CUSTOMER_TYPES)[number];

  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  lastName!: string;

  @ApiProperty({
    type: String,
    description: 'Identification number — exactly 10 digits for cedula, exactly 13 digits for ruc, alphanumeric for pasaporte. Unique within this tenant.',
  })
  @IsString()
  @Length(1, 50)
  @IsTaxIdForType()
  taxId!: string;

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
}
