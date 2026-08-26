import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AddressDto } from './address.dto';

const CUSTOMER_TYPES = ['individual', 'business'] as const;

/** No `tenantId`/`status` field — tenant is always CurrentTenant, and a customer always starts
 * `active` (the column default). `displayName` is the schema's single name column
 * (database.md#customers): the prompt's "nombre + apellido" maps here, not to duplicate
 * first/last columns. `taxId` is the identification field — unique per tenant when present
 * (`customers_tenant_id_tax_id_key` partial index), never globally. */
export class CreateCustomerDto {
  @ApiProperty({ enum: CUSTOMER_TYPES })
  @IsIn(CUSTOMER_TYPES)
  type!: (typeof CUSTOMER_TYPES)[number];

  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  displayName!: string;

  @ApiPropertyOptional({ type: String, maxLength: 50, description: 'Tax id / identification — unique within this tenant when present.' })
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

  @ApiPropertyOptional({ type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;
}
