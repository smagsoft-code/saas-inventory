import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** Only `revoked` is accepted — "generar/revocar" (database.md's permission table) are the only two
 * documented QR lifecycle actions; there is no documented "reactivate a revoked code" workflow, so
 * this DTO does not invent one. Matches `qr_codes_status_check`'s allowed values, restricted further
 * at the application layer to the one direction this phase actually implements. */
export class UpdateQrCodeDto {
  @ApiProperty({ enum: ['revoked'] })
  @IsIn(['revoked'])
  status!: 'revoked';
}
