import { IsUUID } from 'class-validator';
import { CreateQuestionDto } from './create-question.dto';

export class UpdateQuestionDto extends CreateQuestionDto {
  @IsUUID()
  questionId!: string;
}
