import { IsUUID } from 'class-validator';

export class SessionIdDto {
  @IsUUID()
  examSessionId!: string;
}
