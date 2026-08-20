import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** The refresh token normally travels in the httpOnly `refresh_token` cookie (web). This optional
 * body field exists only as a fallback for non-browser callers that can't hold cookies. */
export class RefreshDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
