import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(256)
  password!: string;
}
