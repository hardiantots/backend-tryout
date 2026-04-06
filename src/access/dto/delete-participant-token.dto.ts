import { IsOptional, IsString, IsUUID } from 'class-validator';

export class DeleteParticipantTokenDto {
  @IsUUID()
  tokenId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
