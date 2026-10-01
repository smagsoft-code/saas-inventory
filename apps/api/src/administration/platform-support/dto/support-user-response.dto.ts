import { ApiProperty } from '@nestjs/swagger';

/** SUPPORT_READ view of one tenant user — deliberately a small, fixed field set (never
 * `passwordHash`, never anything beyond what a support diagnostic needs), same "explicit DTO
 * construction, never a spread" discipline ADR-0028 established for sensitive fields elsewhere. */
export class SupportUserResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  email!: string;

  @ApiProperty({ type: String })
  fullName!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: [String] })
  roleNames!: string[];

  @ApiProperty({ type: String })
  createdAt!: string;
}
