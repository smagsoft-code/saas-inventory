import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({ type: String, description: 'The raw invitation token from the link — never its hash.' })
  @IsString()
  @Length(16, 256)
  token!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128, description: 'Minimum 10 characters — same policy as registration.' })
  @IsString()
  @Length(10, 128)
  password!: string;
}
