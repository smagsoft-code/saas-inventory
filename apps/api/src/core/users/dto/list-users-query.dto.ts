import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const USER_STATUSES = ['invited', 'active', 'disabled'] as const;

/** api.md#pagination-filtering-sorting-search's offset-based `page`/`pageSize` convention.
 * `status` is the one documented, allow-listed filter (§11); `q` (LOGIN + USUARIOS UI/UX block,
 * closing `GAP-USER-FILTERS`'s name-search half) is a free-text, case-insensitive, partial match
 * against `fullName` only — never `email`, resolved server-side (`UsersRepository.findManyByTenant`,
 * the same `ILIKE '%q%'` convention `CustomersRepository.listByTenant` already established) so it
 * composes correctly with pagination instead of filtering an already-paged slice client-side. */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({ type: String, maxLength: 100, description: 'Free-text search: fullName only, partial, case-insensitive.' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}
