import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * 016-C / ADR-0033: login is `{ email, password }` only. `email` resolves a global `identities`
 * row (case-insensitive) and the password is checked against `identities.password_hash` — the
 * credential belongs to the person, not to any tenant. The client cannot name a tenant on this
 * request at all: which company (if the identity has more than one) is chosen *after* the
 * credentials are validated, via `POST /auth/select-tenant`.
 *
 * `email` is not required to be a real email address (LOGIN + USUARIOS UI/UX block) — it must
 * accept exactly whatever `CreateUserDto.email` (UI label "Usuario") accepted at creation,
 * including a non-email identifier of 10+ characters, alongside a pre-existing user's real email
 * (unaffected). Leaving this `@IsEmail()` while relaxing creation would strand every new-style
 * account at login — never a valid split. Matching is plain case-insensitive string equality
 * (`IdentitiesRepository.findByEmail`), never format-dependent.
 */
export class LoginDto {
  @ApiProperty({ type: String, description: 'Login identifier — the value set as "Usuario" (or an existing email) at user creation.' })
  @IsString()
  @Length(1, 255)
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
