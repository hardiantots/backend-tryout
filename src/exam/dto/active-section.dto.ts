import { IsUUID } from 'class-validator';

export class ActiveSectionDto {
  @IsUUID()
  examSessionId!: string;
}
