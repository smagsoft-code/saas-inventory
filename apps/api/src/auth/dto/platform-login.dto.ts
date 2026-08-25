import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** No `tenantSlug` field (unlike LoginDto) — platform_admins.email is globally unique
 * (migration 0001), there is no tenant to disambiguate against. */
export class PlatformLoginDto {
  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
