import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsUUID()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword!: string;
}
