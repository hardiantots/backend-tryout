import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AiService } from './ai.service';
import { AiInsightDto } from './dto/ai-insight.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('insight')
  async insight(@Body() body: AiInsightDto, @CurrentUser() user: AuthUser) {
    return this.aiService.generateInsight(body.examSessionId, user.sub);
  }
}
