import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DeleteUserDto {
  @IsUUID()
  targetUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
