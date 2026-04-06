import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateParticipantTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
