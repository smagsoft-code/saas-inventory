import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { QrCodeResponseDto } from './qr-code-response.dto';

/** One `variantIds` entry's outcome — never silently dropped (§10). `'created'` carries the new
 * `qrCode`; `'skipped'` covers the already-has-an-active-QR case (idempotent — re-submitting the
 * same bulk request is always safe, matching the single-create endpoint's own 409-avoidance
 * contract, just without failing the whole batch); `'error'` covers everything else (target not
 * found in this tenant, a genuine failure) with a human-readable `reason`. */
export class BulkCreateQrCodeResultDto {
  @ApiProperty({ type: String })
  variantId!: string;

  @ApiProperty({ enum: ['created', 'skipped', 'error'] })
  status!: 'created' | 'skipped' | 'error';

  @ApiProperty({ type: QrCodeResponseDto, required: false })
  qrCode?: QrCodeResponseDto;

  @ApiProperty({ type: String, required: false, description: 'Present for "skipped"/"error" — why this variant was not generated.' })
  reason?: string;
}

@ApiExtraModels(BulkCreateQrCodeResultDto)
export class BulkCreateQrCodesResponseDto {
  @ApiProperty({ type: 'array', items: { $ref: getSchemaPath(BulkCreateQrCodeResultDto) } })
  results!: BulkCreateQrCodeResultDto[];

  @ApiProperty({ type: 'object', properties: { created: { type: 'number' }, skipped: { type: 'number' }, errors: { type: 'number' } } })
  summary!: { created: number; skipped: number; errors: number };
}
