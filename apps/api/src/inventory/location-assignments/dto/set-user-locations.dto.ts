import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** An empty array is valid and meaningful — ADR-0024: a user with zero
 * `user_location_assignments` rows is unrestricted (all tenant locations), not "assigned to
 * nothing." Every id, when given, is validated against the caller's own tenant by the service
 * layer (a client-supplied id from another tenant simply resolves as not found). */
export class SetUserLocationsDto {
  @ApiProperty({ type: String, isArray: true, description: 'Existing location ids in the current tenant. Empty = unrestricted (ADR-0024).' })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  locationIds!: string[];
}
