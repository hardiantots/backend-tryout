import { IsUUID } from 'class-validator';

export class ScoreSessionDto {
  @IsUUID()
  examSessionId!: string;
}
