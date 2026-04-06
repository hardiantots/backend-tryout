import { IsInt, IsUUID, Min } from 'class-validator';

export class HeartbeatDto {
  @IsUUID()
  examSessionId!: string;

  @IsInt()
  @Min(1)
  sectionOrder!: number;

  @IsInt()
  @Min(0)
  clientRemainingSeconds!: number;
}
