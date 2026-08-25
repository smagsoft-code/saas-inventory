import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** One weekday's opening hours — governed shape, not an open key/value bag (§8/§9 of this phase):
 * `dayOfWeek` is 0 (Sunday) through 6 (Saturday), ISO-adjacent but zero-based to match
 * `Date.prototype.getDay()`, the value any frontend consuming this will already have on hand. */
export class BusinessHoursEntryDto {
  @ApiProperty({ type: Number, enum: DAYS_OF_WEEK, description: '0 = Sunday ... 6 = Saturday.' })
  @IsIn(DAYS_OF_WEEK)
  dayOfWeek!: number;

  @ApiPropertyOptional({ type: Boolean, default: false, description: 'true = closed all day; opensAt/closesAt are ignored.' })
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @ApiPropertyOptional({ type: String, example: '09:00', description: '24h "HH:mm". Required unless isClosed.' })
  @ValidateIf((entry: BusinessHoursEntryDto) => entry.isClosed !== true)
  @Matches(HHMM_PATTERN, { message: 'opensAt must be a 24h "HH:mm" time.' })
  opensAt?: string;

  @ApiPropertyOptional({ type: String, example: '18:00', description: '24h "HH:mm". Required unless isClosed.' })
  @ValidateIf((entry: BusinessHoursEntryDto) => entry.isClosed !== true)
  @Matches(HHMM_PATTERN, { message: 'closesAt must be a 24h "HH:mm" time.' })
  closesAt?: string;
}
