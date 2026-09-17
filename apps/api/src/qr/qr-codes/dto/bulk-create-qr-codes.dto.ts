import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * `POST /qr-codes/bulk` body. Same array-of-ids shape/validation convention as
 * `set-user-locations.dto.ts` (`ArrayUnique` — a client sending the same id twice is a 400, not a
 * silent dedupe; this frontend's own selection state is a `Set` so it never happens from the real
 * UI). Bounded to 100 (`ArrayMaxSize`) — the same page-size cap `pending-variants` itself returns,
 * so "select all" from one loaded page can always be submitted in one request. Every id is
 * revalidated against the caller's own tenant and current QR state in the service layer exactly
 * like the single-create endpoint — never trusted as-is.
 */
export class BulkCreateQrCodesDto {
  @ApiProperty({ type: String, isArray: true, description: 'product_variant ids to generate a QR code for.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  variantIds!: string[];
}
