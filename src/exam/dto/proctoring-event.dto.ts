import { IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProctoringEventType } from '../exam.types';

export class ProctoringEventDto {
  @IsUUID()
  sessionId!: string;

  @IsEnum(ProctoringEventType)
  eventType!: ProctoringEventType;

  @IsOptional()
  @IsString()
  clientTimestamp?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
