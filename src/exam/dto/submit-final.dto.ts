import { IsUUID } from 'class-validator';

export class SubmitFinalDto {
  @IsUUID()
  examSessionId!: string;
}
