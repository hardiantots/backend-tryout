import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { AnswerOption } from '../../question/question.types';

export class SubmitAttemptDto {
  @IsUUID()
  examSessionId!: string;

  @IsUUID()
  questionId!: string;

  @IsOptional()
  @IsEnum(AnswerOption)
  selectedAnswer?: AnswerOption;

  @IsOptional()
  @IsString()
  shortAnswerText?: string;

  @ValidateIf((o: SubmitAttemptDto) => o.selectedAnswers != null)
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  selectedAnswers?: string[];
}
