import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller';
import { ExamService } from './exam.service';
import { ScoringQueueService } from './scoring/scoring-queue.service';
import { ScoringWorkerService } from './scoring/scoring-worker.service';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [S3Module],
  controllers: [ExamController],
  providers: [ExamService, ScoringQueueService, ScoringWorkerService],
})
export class ExamModule {}
