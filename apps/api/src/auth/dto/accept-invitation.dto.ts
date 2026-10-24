import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({ type: String, description: 'The raw invitation token from the link — never its hash.' })
  @IsString()
  @Length(16, 256)
  token!: string;

  @ApiProperty({ type: String, description: 'No composition or length rule — same policy as registration (it only must not be empty).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
