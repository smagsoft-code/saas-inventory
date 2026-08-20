import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description:
      'The tenant slug identifying which company to log into. Required because email is unique ' +
      'per tenant, not globally (users.email is unique on (tenant_id, email)) — see ADR-0030.',
  })
  @IsString()
  @Length(1, 80)
  tenantSlug!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
