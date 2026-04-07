import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParticipantTokenLoginDto {
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  token!: string;
}
