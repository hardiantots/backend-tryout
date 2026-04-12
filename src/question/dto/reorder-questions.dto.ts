import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderQuestionsDto {
  @IsUUID()
  subTestId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  questionIds!: string[];
}
