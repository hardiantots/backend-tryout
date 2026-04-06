import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { QuestionController } from './question.controller';
import { QuestionService } from './question.service';

@Module({
  imports: [AccessModule],
  controllers: [QuestionController],
  providers: [QuestionService],
})
export class QuestionModule {}
