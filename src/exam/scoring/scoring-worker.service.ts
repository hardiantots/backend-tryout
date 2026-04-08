import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ExamService } from '../exam.service';
import { ScoringQueueService } from './scoring-queue.service';

@Injectable()
export class ScoringWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoringWorkerService.name);
  private stopped = false;
  private running = false;

  constructor(
    private readonly scoringQueueService: ScoringQueueService,
    private readonly examService: ExamService,
  ) {}

  onModuleInit() {
    const enabled = (process.env.SCORING_WORKER_ENABLED ?? 'true').toLowerCase() === 'true';
    if (!enabled) {
      this.logger.log('Scoring worker is disabled by SCORING_WORKER_ENABLED=false');
      return;
    }

    this.running = true;
    void this.loop();
    this.logger.log('Scoring worker started.');
  }

  onModuleDestroy() {
    this.stopped = true;
    this.running = false;
    this.logger.log('Scoring worker stopping...');
  }

  private async loop() {
    while (!this.stopped) {
      try {
        const messages = await this.scoringQueueService.receiveScoreMessages(1);
        if (!messages.length) {
          continue;
        }

        for (const message of messages) {
          if (!message.ReceiptHandle) {
            continue;
          }

          const payload = this.scoringQueueService.parseMessageBody(message);
          if (!payload) {
            this.logger.warn('Invalid message payload, deleting message.');
            await this.scoringQueueService.deleteMessage(message.ReceiptHandle);
            continue;
          }

          try {
            await this.examService.processScoreSessionJob(payload.examSessionId, payload.requesterUserId);
            await this.scoringQueueService.deleteMessage(message.ReceiptHandle);
          } catch (error) {
            this.logger.error(
              `Scoring failed for session ${payload.examSessionId}: ${(error as Error).message}`,
              (error as Error).stack,
            );
          }
        }
      } catch (error) {
        this.logger.error(`Worker loop error: ${(error as Error).message}`, (error as Error).stack);
      }
    }

    this.running = false;
  }

  isRunning() {
    return this.running;
  }
}
