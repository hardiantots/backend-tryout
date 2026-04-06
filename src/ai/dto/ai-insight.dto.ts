import { IsUUID } from 'class-validator';

export class AiInsightDto {
  @IsUUID()
  examSessionId!: string;
}
