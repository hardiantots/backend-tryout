import { IsString, MinLength } from 'class-validator';

export class ValidateParticipantTokenDto {
  @IsString()
  @MinLength(12)
  token!: string;
}
