import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ForceSubmitDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  warningCount?: number;

  @IsString()
  @MaxLength(200)
  reason!: string;
}
