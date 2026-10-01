import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

/** ADR-0036 — no `password` field, deliberately (§1/§3 of the prompt: "No solicitar contraseña
 * del administrador inicial"). No `slug` either — derived automatically, same as
 * `POST /auth/register` (`TenantProvisioningService.reserveSlug`), never client-supplied. */
export class CreatePlatformTenantDto {
  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  companyName!: string;

  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  adminFullName!: string;

  @ApiProperty({ type: String })
  @IsEmail()
  adminEmail!: string;
}
