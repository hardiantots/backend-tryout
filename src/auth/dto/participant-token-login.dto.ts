import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParticipantTokenLoginDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  token!: string;
}
