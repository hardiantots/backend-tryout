import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActiveSectionDto } from './dto/active-section.dto';
import { ActiveQuestionDto } from './dto/active-question.dto';
import { ForceSubmitDto } from './dto/force-submit.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { ProctoringEventDto } from './dto/proctoring-event.dto';
import { ScoreSessionDto } from './dto/score-session.dto';
import { SectionQuestionsDto } from './dto/section-questions.dto';
import { SessionIdDto } from './dto/session-id.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitFinalDto } from './dto/submit-final.dto';
import { ExamService } from './exam.service';

@Controller('exam')
@UseGuards(JwtAuthGuard)
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Post('start-session')
  async startSession(@Body() body: StartSessionDto, @CurrentUser() user: AuthUser) {
    return this.examService.startSession(user.sub, body);
  }

  @Post('resume-session')
  async resumeSession(@CurrentUser() user: AuthUser) {
    return this.examService.resumeSession(user.sub);
  }

  @Post('active-section')
  async activeSection(@Body() body: ActiveSectionDto, @CurrentUser() user: AuthUser) {
    return this.examService.getActiveSection(body.examSessionId, user.sub);
  }

  @Post('heartbeat')
  async heartbeat(@Body() body: HeartbeatDto, @CurrentUser() user: AuthUser) {
    return this.examService.heartbeat(body, user.sub);
  }

  @Post('section-questions')
  async sectionQuestions(@Body() body: SectionQuestionsDto, @CurrentUser() user: AuthUser) {
    return this.examService.getSectionQuestions(body.examSessionId, user.sub);
  }

  @Post('active-question')
  async activeQuestion(@Body() body: ActiveQuestionDto, @CurrentUser() user: AuthUser) {
    return this.examService.setActiveQuestion(body.examSessionId, user.sub, body.questionId);
  }

  @Post('proctoring-event')
  async recordProctoringEvent(@Body() body: ProctoringEventDto, @CurrentUser() user: AuthUser) {
    return this.examService.recordProctoringEvent(body, user.sub);
  }

  @Post('force-submit')
  async forceSubmit(@Body() body: ForceSubmitDto, @CurrentUser() user: AuthUser) {
    return this.examService.forceSubmit(body, user.sub);
  }

  @Post('submit-attempt')
  async submitAttempt(@Body() body: SubmitAttemptDto, @CurrentUser() user: AuthUser) {
    return this.examService.submitAttempt(body, user.sub);
  }

  @Post('complete-section-early')
  async completeSectionEarly(@Body() body: SessionIdDto, @CurrentUser() user: AuthUser) {
    return this.examService.completeSectionEarly(body.examSessionId, user.sub);
  }

  @Post('score-session')
  async scoreSession(@Body() body: ScoreSessionDto, @CurrentUser() user: AuthUser) {
    return this.examService.scoreSession(body, user.sub);
  }

  @Post('complete-session')
  async completeSession(@Body() body: SessionIdDto, @CurrentUser() user: AuthUser) {
    return this.examService.completeSession(body.examSessionId, user.sub);
  }

  @Post('result')
  async result(@Body() body: SessionIdDto, @CurrentUser() user: AuthUser) {
    return this.examService.getSessionResult(body.examSessionId, user.sub);
  }

  @Post('submit-final')
  async submitFinal(@Body() body: SubmitFinalDto, @CurrentUser() user: AuthUser) {
    return this.examService.submitFinal(body.examSessionId, user.sub);
  }

  @Post('latest-completed-session')
  async latestCompletedSession(@CurrentUser() user: AuthUser) {
    return this.examService.getLatestCompletedSession(user.sub);
  }
}
