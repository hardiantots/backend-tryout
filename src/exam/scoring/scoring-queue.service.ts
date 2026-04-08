import { Injectable, Logger } from '@nestjs/common';
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { getRequiredEnv } from '../../common/config/env.util';

type EnqueueScoreSessionPayload = {
  examSessionId: string;
  requesterUserId: string;
  requestedAt: string;
};

@Injectable()
export class ScoringQueueService {
  private readonly logger = new Logger(ScoringQueueService.name);
  private client: SQSClient | null = null;

  private getClient(): SQSClient {
    if (!this.client) {
      this.client = new SQSClient({ region: getRequiredEnv('AWS_REGION') });
    }
    return this.client;
  }

  private getQueueUrl(): string {
    const queueUrl = process.env.AWS_SQS_SCORING_QUEUE_URL?.trim() || process.env.AWS_SQS_QUEUE_URL?.trim();
    if (!queueUrl) {
      throw new Error('Missing required environment variable: AWS_SQS_SCORING_QUEUE_URL (or AWS_SQS_QUEUE_URL).');
    }
    return queueUrl;
  }

  async enqueueScoreSessionJob(payload: EnqueueScoreSessionPayload) {
    const command = new SendMessageCommand({
      QueueUrl: this.getQueueUrl(),
      MessageBody: JSON.stringify(payload),
    });

    const response = await this.getClient().send(command);

    return {
      messageId: response.MessageId ?? null,
      queueUrl: this.getQueueUrl(),
    };
  }

  async receiveScoreMessages(maxNumberOfMessages = 1): Promise<Message[]> {
    const waitTimeSecondsRaw = Number(process.env.SCORING_QUEUE_WAIT_TIME_SECONDS ?? 20);
    const visibilityTimeoutRaw = Number(process.env.SCORING_QUEUE_VISIBILITY_TIMEOUT_SECONDS ?? 90);

    const waitTimeSeconds = Number.isFinite(waitTimeSecondsRaw) ? Math.min(Math.max(Math.floor(waitTimeSecondsRaw), 1), 20) : 20;
    const visibilityTimeout = Number.isFinite(visibilityTimeoutRaw)
      ? Math.min(Math.max(Math.floor(visibilityTimeoutRaw), 30), 43200)
      : 90;

    const response = await this.getClient().send(
      new ReceiveMessageCommand({
        QueueUrl: this.getQueueUrl(),
        MaxNumberOfMessages: Math.min(Math.max(Math.floor(maxNumberOfMessages), 1), 10),
        WaitTimeSeconds: waitTimeSeconds,
        VisibilityTimeout: visibilityTimeout,
      }),
    );

    return response.Messages ?? [];
  }

  async deleteMessage(receiptHandle: string) {
    await this.getClient().send(
      new DeleteMessageCommand({
        QueueUrl: this.getQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  parseMessageBody(message: Message): EnqueueScoreSessionPayload | null {
    if (!message.Body) {
      return null;
    }

    try {
      const parsed = JSON.parse(message.Body) as Partial<EnqueueScoreSessionPayload>;
      if (!parsed.examSessionId || !parsed.requesterUserId) {
        return null;
      }

      return {
        examSessionId: parsed.examSessionId,
        requesterUserId: parsed.requesterUserId,
        requestedAt: parsed.requestedAt ?? new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to parse SQS message body: ${(error as Error).message}`);
      return null;
    }
  }
}
