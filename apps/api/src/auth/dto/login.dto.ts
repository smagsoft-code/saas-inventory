import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * 016-C / ADR-0033: login is `{ email, password }` only. `email` resolves a global `identities`
 * row (case-insensitive) and the password is checked against `identities.password_hash` — the
 * credential belongs to the person, not to any tenant. The client cannot name a tenant on this
 * request at all: which company (if the identity has more than one) is chosen *after* the
 * credentials are validated, via `POST /auth/select-tenant`.
 */
export class LoginDto {
  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
