import { IsUUID } from 'class-validator';

export class ActiveQuestionDto {
  @IsUUID()
  examSessionId!: string;

  @IsUUID()
  questionId!: string;
}
