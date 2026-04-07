import { IsUUID } from 'class-validator';

export class DeleteQuestionDto {
  @IsUUID()
  questionId!: string;
}
