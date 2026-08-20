import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'The new company/tenant name.', minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  companyName!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 10, maxLength: 128, description: 'Minimum 10 characters.' })
  @IsString()
  @Length(10, 128)
  password!: string;

  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  fullName!: string;
}
