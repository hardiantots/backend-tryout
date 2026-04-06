import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ListQuestionsDto } from './dto/list-questions.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionService } from './question.service';

@Controller('admin/questions')
@UseGuards(JwtAuthGuard)
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  @Get('subtests')
  async getWritableSubTests(@CurrentUser() user: AuthUser) {
    return this.questionService.getWritableSubTests(user.sub);
  }

  @Post()
  async createQuestion(@CurrentUser() user: AuthUser, @Body() dto: CreateQuestionDto) {
    return this.questionService.createQuestion(user.sub, dto);
  }

  @Get()
  async listQuestions(@CurrentUser() user: AuthUser, @Query() query: ListQuestionsDto) {
    return this.questionService.listQuestions(user.sub, query);
  }

  @Post('update')
  async updateQuestion(@CurrentUser() user: AuthUser, @Body() dto: UpdateQuestionDto) {
    return this.questionService.updateQuestion(user.sub, dto);
  }

  @Post('upload-url')
  async getUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: RequestUploadUrlDto) {
    return this.questionService.getQuestionImageUploadUrl(user.sub, dto);
  }
}
