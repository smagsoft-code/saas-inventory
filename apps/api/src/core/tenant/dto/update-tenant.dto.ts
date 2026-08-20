import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Deliberately the only editable field (§7/§9) — `slug`/`status`/`isDemo` have no field here at
 * all, so DTO whitelisting (main.ts's ValidationPipe, forbidNonWhitelisted: true) rejects any
 * attempt to send them, independent of the service layer never reading them either. */
export class UpdateTenantDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  name!: string;
}
