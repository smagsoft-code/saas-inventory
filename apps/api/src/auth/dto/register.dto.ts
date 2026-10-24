import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ type: String, description: 'The new company/tenant name.', minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  companyName!: string;

  @ApiProperty({ type: String })
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    description:
      'No composition or length rule (owner decision for company creation) — only that it is not empty. The 1024 cap is not a policy: it only bounds the work a single hash request can cost.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;

  @ApiProperty({ type: String, minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  fullName!: string;
}
