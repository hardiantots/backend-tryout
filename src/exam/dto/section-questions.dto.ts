import { IsUUID } from 'class-validator';

export class SectionQuestionsDto {
  @IsUUID()
  examSessionId!: string;
}
