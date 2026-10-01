import { ApiProperty } from '@nestjs/swagger';

/** `GET /inventory/location-scope` — the caller's own ADR-0024 operating scope. `unrestricted:
 * true` (the founding Administrador exception, ADR-0035) means every location in the tenant is in
 * scope and `locationIds` is empty; otherwise `locationIds` is the exhaustive, explicit list —
 * never inferred, never "everything not denied". */
export class LocationScopeResponseDto {
  @ApiProperty({ type: Boolean })
  unrestricted!: boolean;

  @ApiProperty({ type: [String] })
  locationIds!: string[];
}
