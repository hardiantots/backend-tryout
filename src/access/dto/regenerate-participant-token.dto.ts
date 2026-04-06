import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegenerateParticipantTokenDto {
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  tokenKey!: string;
}
