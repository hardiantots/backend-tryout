import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { S3Module } from '../s3/s3.module';
import { QuestionController } from './question.controller';
import { QuestionService } from './question.service';

@Module({
  imports: [AccessModule, S3Module],
  controllers: [QuestionController],
  providers: [QuestionService],
})
export class QuestionModule {}
