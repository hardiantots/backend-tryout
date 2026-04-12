import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResetAntiCheatDto {
  @IsString()
  @IsNotEmpty()
  tokenKey!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
