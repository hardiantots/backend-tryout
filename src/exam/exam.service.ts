import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveQuestionDto } from './dto/active-question.dto';
import { ForceSubmitDto } from './dto/force-submit.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { ProctoringEventDto } from './dto/proctoring-event.dto';
import { ScoreSessionDto } from './dto/score-session.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { ExamSessionStatus, ProctoringEventType } from './exam.types';
import { QuestionAnswerFormat, ShortAnswerType } from '../question/question.types';
import { ScoringQueueService } from './scoring/scoring-queue.service';

const VIOLATION_TYPES: ProctoringEventType[] = [ProctoringEventType.TAB_HIDDEN, ProctoringEventType.WINDOW_BLUR];

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringQueueService: ScoringQueueService,
  ) {}

  private getServerRemainingSeconds(progress: {
    startedAt: Date | null;
    remainingSecondsAtLastSync: number;
    sectionSchedule: { durationSeconds: number };
  }) {
    if (!progress.startedAt) {
      return progress.remainingSecondsAtLastSync;
    }

    const elapsed = Math.max(0, Math.floor((Date.now() - progress.startedAt.getTime()) / 1000));
    const duration = Math.max(0, progress.sectionSchedule.durationSeconds);
    const byClock = Math.max(0, duration - elapsed);
    return Math.min(progress.remainingSecondsAtLastSync, byClock);
  }

  private async getActiveParticipantToken(userId: string) {
    return this.prisma.participantAccessToken.findFirst({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureExistingUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }
    return user;
  }

  private async assertSessionOwner(examSessionId: string, userId: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: examSessionId },
      select: {
        id: true,
        userId: true,
        status: true,
        submittedAt: true,
        warningCount: true,
        currentSectionOrder: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${examSessionId} not found.`);
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('You do not have access to this exam session.');
    }

    return session;
  }

  private async getOrderedSchedules() {
    return this.prisma.sectionSchedule.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: 'asc' },
      include: {
        subTest: true,
      },
    });
  }

  private async moveToNextSection(tx: any, examSessionId: string, currentOrder: number) {
    const schedules = await tx.sectionSchedule.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: 'asc' },
      include: { subTest: true },
    });
    const next = schedules.find((s: any) => s.orderIndex === currentOrder + 1);

    if (!next) {
      await tx.examSession.update({
        where: { id: examSessionId },
        data: {
          currentSectionOrder: currentOrder,
        },
      });
      return {
        hasNext: false,
        nextOrder: currentOrder,
        nextDuration: 0,
      };
    }

    const progressToActivate = await tx.sessionSectionProgress.findFirst({
      where: {
        examSessionId,
        status: 'LOCKED',
        sectionSchedule: {
          orderIndex: next.orderIndex,
        },
      },
    });

    if (progressToActivate) {
      await tx.sessionSectionProgress.update({
        where: { id: progressToActivate.id },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });
    }

    await tx.examSession.update({
      where: { id: examSessionId },
      data: {
        currentSectionOrder: next.orderIndex,
      },
    });

    return {
      hasNext: true,
      nextOrder: next.orderIndex,
      nextDuration: next.durationSeconds,
    };
  }

  async startSession(requesterUserId: string, _dto: StartSessionDto) {
    const dto = _dto;
    const user = await this.ensureExistingUser(requesterUserId);

    const participantRole = await this.prisma.userRole.findFirst({
      where: {
        userId: requesterUserId,
        revokedAt: null,
        role: {
          code: 'PARTICIPANT',
        },
      },
    });
    if (!participantRole) {
      throw new ForbiddenException('Hanya participant yang dapat memulai sesi ujian.');
    }

    const participantToken = await this.getActiveParticipantToken(requesterUserId);
    if (!participantToken) {
      throw new ForbiddenException('Akses ujian participant wajib menggunakan token dari master admin.');
    }

    if (!dto.agreedToTerms) {
      throw new BadRequestException('Kamu harus menyetujui ketentuan sebelum mengerjakan ujian.');
    }

    if (!dto.fullName?.trim() || !dto.congregation?.trim() || !dto.schoolName?.trim()) {
      throw new BadRequestException('Nama, asal jemaat, dan sekolah asal wajib diisi.');
    }

    const schedules = await this.getOrderedSchedules();

    if (!schedules.length) {
      throw new NotFoundException('No active section schedules found.');
    }

    const existing = await this.prisma.examSession.findFirst({
      where: {
        userId: user.id,
        status: ExamSessionStatus.IN_PROGRESS,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        userId: true,
        currentSectionOrder: true,
        currentQuestionId: true,
      },
    });

    if (existing) {
      return {
        success: true,
        examSessionId: existing.id,
        userId: existing.userId,
        activeSectionOrder: existing.currentSectionOrder,
        activeQuestionId: existing.currentQuestionId,
        resumed: true,
        participantProfile: {
          fullName: dto.fullName.trim(),
          congregation: dto.congregation.trim(),
          schoolName: dto.schoolName.trim(),
        },
        sections: schedules.map((s) => ({
          order: s.orderIndex,
          code: s.subTest.code,
          title: s.subTest.name,
          durationSeconds: s.durationSeconds,
        })),
      };
    }

    const session = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.examSession.create({
        data: {
          userId: user.id,
          participantAccessTokenId: participantToken.id,
          participantName: dto.fullName.trim(),
          participantCongregation: dto.congregation.trim(),
          participantSchool: dto.schoolName.trim(),
          termsAcceptedAt: new Date(),
          status: ExamSessionStatus.IN_PROGRESS,
          startedAt: new Date(),
          currentSectionOrder: schedules[0].orderIndex,
          totalDurationSeconds: schedules.reduce((sum, s) => sum + s.durationSeconds, 0),
        },
      });

      for (const schedule of schedules) {
        await tx.sessionSectionProgress.create({
          data: {
            examSessionId: created.id,
            sectionScheduleId: schedule.id,
            status: schedule.orderIndex === schedules[0].orderIndex ? 'ACTIVE' : 'LOCKED',
            startedAt: schedule.orderIndex === schedules[0].orderIndex ? new Date() : null,
            remainingSecondsAtLastSync: schedule.durationSeconds,
            autoAdvanced: false,
          },
        });
      }

      return created;
    });

    return {
      success: true,
      examSessionId: session.id,
      userId: user.id,
      activeSectionOrder: schedules[0].orderIndex,
      resumed: false,
      participantProfile: {
        fullName: dto.fullName.trim(),
        congregation: dto.congregation.trim(),
        schoolName: dto.schoolName.trim(),
      },
      sections: schedules.map((s) => ({
        order: s.orderIndex,
        code: s.subTest.code,
        title: s.subTest.name,
        durationSeconds: s.durationSeconds,
      })),
    };
  }

  async resumeSession(requesterUserId: string) {
    await this.ensureExistingUser(requesterUserId);

    const existing = await this.prisma.examSession.findFirst({
      where: {
        userId: requesterUserId,
        status: ExamSessionStatus.IN_PROGRESS,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        currentSectionOrder: true,
        currentQuestionId: true,
        warningCount: true,
      },
    });

    if (!existing) {
      const latestCompleted = await this.prisma.examSession.findFirst({
        where: {
          userId: requesterUserId,
          status: {
            in: [ExamSessionStatus.SUBMITTED, ExamSessionStatus.AUTO_SUBMITTED, ExamSessionStatus.EXPIRED],
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          warningCount: true,
        },
      });

      return {
        success: true,
        resumed: false,
        hasCompletedSession: Boolean(latestCompleted),
        latestCompletedSession: latestCompleted
          ? {
              examSessionId: latestCompleted.id,
              status: latestCompleted.status,
              submittedAt: latestCompleted.submittedAt,
              warningCount: latestCompleted.warningCount,
            }
          : null,
      };
    }

    const schedules = await this.getOrderedSchedules();

    return {
      success: true,
      resumed: true,
      examSessionId: existing.id,
      activeSectionOrder: existing.currentSectionOrder,
      activeQuestionId: existing.currentQuestionId,
      warningCount: existing.warningCount,
      sections: schedules.map((s) => ({
        order: s.orderIndex,
        code: s.subTest.code,
        title: s.subTest.name,
        durationSeconds: s.durationSeconds,
      })),
    };
  }

  async getActiveSection(examSessionId: string, requesterUserId: string) {
    const ownerSession = await this.assertSessionOwner(examSessionId, requesterUserId);

    if (
      ownerSession.status === ExamSessionStatus.SUBMITTED ||
      ownerSession.status === ExamSessionStatus.AUTO_SUBMITTED ||
      ownerSession.status === ExamSessionStatus.EXPIRED
    ) {
      return {
        success: true,
        examSessionId,
        isFinished: true,
        status: ownerSession.status,
        warningCount: ownerSession.warningCount,
      };
    }

    const session = await this.prisma.examSession.findUnique({
      where: { id: examSessionId },
      include: {
        sectionProgresses: {
          include: {
            sectionSchedule: {
              include: { subTest: true },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${examSessionId} not found.`);
    }

    const active = session.sectionProgresses.find((p) => p.status === 'ACTIVE');
    if (!active) {
      return {
        success: true,
        examSessionId,
        isFinished: true,
        status: session.status,
        warningCount: session.warningCount,
      };
    }

    const serverRemainingSeconds = this.getServerRemainingSeconds(active);

    return {
      success: true,
      examSessionId,
      isFinished: false,
      status: session.status,
      warningCount: session.warningCount,
      activeQuestionId: session.currentQuestionId,
      activeSection: {
        order: active.sectionSchedule.orderIndex,
        code: active.sectionSchedule.subTest.code,
        title: active.sectionSchedule.subTest.name,
        serverRemainingSeconds,
      },
    };
  }

  async heartbeat(dto: HeartbeatDto, requesterUserId: string) {
    const session = await this.assertSessionOwner(dto.examSessionId, requesterUserId);

    return this.prisma.$transaction(async (tx: any) => {
      const currentProgress = await tx.sessionSectionProgress.findFirst({
        where: {
          examSessionId: dto.examSessionId,
          status: 'ACTIVE',
          sectionSchedule: {
            orderIndex: dto.sectionOrder,
          },
        },
        include: {
          sectionSchedule: true,
        },
      });

      if (!currentProgress) {
        const refreshed = await this.getActiveSection(dto.examSessionId, requesterUserId);
        return {
          success: true,
          shouldAutoAdvance: false,
          activeSectionOrder: refreshed.activeSection?.order ?? session.currentSectionOrder,
          serverRemainingSeconds: refreshed.activeSection?.serverRemainingSeconds ?? 0,
          warningCount: refreshed.warningCount ?? session.warningCount,
        };
      }

      const serverRemaining = this.getServerRemainingSeconds(currentProgress);
      const nextRemaining = Math.min(serverRemaining, dto.clientRemainingSeconds);

      await tx.sessionSectionProgress.update({
        where: { id: currentProgress.id },
        data: {
          remainingSecondsAtLastSync: nextRemaining,
        },
      });

      if (nextRemaining > 0) {
        return {
          success: true,
          shouldAutoAdvance: false,
          activeSectionOrder: dto.sectionOrder,
          serverRemainingSeconds: nextRemaining,
          warningCount: session.warningCount,
        };
      }

      await tx.sessionSectionProgress.update({
        where: { id: currentProgress.id },
        data: {
          status: 'SKIPPED_BY_TIMEOUT',
          endedAt: new Date(),
          autoAdvanced: true,
        },
      });

      const moved = await this.moveToNextSection(tx, dto.examSessionId, dto.sectionOrder);
      return {
        success: true,
        shouldAutoAdvance: true,
        activeSectionOrder: moved.nextOrder,
        serverRemainingSeconds: moved.nextDuration,
        isFinished: !moved.hasNext,
        warningCount: session.warningCount,
      };
    });
  }

  async completeSectionEarly(examSessionId: string, requesterUserId: string) {
    const session = await this.assertSessionOwner(examSessionId, requesterUserId);

    if (session.status !== ExamSessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Sesi ujian sudah selesai.');
    }

    return this.prisma.$transaction(async (tx: any) => {
      const currentProgress = await tx.sessionSectionProgress.findFirst({
        where: {
          examSessionId,
          status: 'ACTIVE',
        },
        include: {
          sectionSchedule: true,
        },
      });

      if (!currentProgress) {
        const refreshed = await this.getActiveSection(examSessionId, requesterUserId);
        return {
          success: true,
          moved: false,
          activeSectionOrder: refreshed.activeSection?.order ?? session.currentSectionOrder,
          serverRemainingSeconds: refreshed.activeSection?.serverRemainingSeconds ?? 0,
          isFinished: refreshed.isFinished,
          warningCount: refreshed.warningCount ?? session.warningCount,
        };
      }

      await tx.sessionSectionProgress.update({
        where: { id: currentProgress.id },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
          autoAdvanced: false,
        },
      });

      const moved = await this.moveToNextSection(tx, examSessionId, currentProgress.sectionSchedule.orderIndex);

      return {
        success: true,
        moved: true,
        activeSectionOrder: moved.nextOrder,
        serverRemainingSeconds: moved.nextDuration,
        isFinished: !moved.hasNext,
        warningCount: session.warningCount,
      };
    });
  }

  async getSectionQuestions(examSessionId: string, requesterUserId: string) {
    const active = await this.getActiveSection(examSessionId, requesterUserId);
    if (active.isFinished || !active.activeSection) {
      return {
        success: true,
        examSessionId,
        isFinished: true,
        warningCount: active.warningCount ?? 0,
        questions: [],
      };
    }

    const subTest = await this.prisma.subTest.findUnique({
      where: { code: active.activeSection.code },
      include: {
        questions: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!subTest) {
      throw new NotFoundException(`SubTest ${active.activeSection.code} not found.`);
    }

    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examSessionId,
        questionId: {
          in: subTest.questions.map((q) => q.id),
        },
      },
    });

    const attemptMap = new Map(attempts.map((a) => [a.questionId, a]));

    return {
      success: true,
      examSessionId,
      isFinished: false,
      warningCount: active.warningCount ?? 0,
      activeSection: active.activeSection,
      questions: subTest.questions.map((q) => ({
        id: q.id,
        promptText: q.promptText,
        materialTopic: q.materialTopic,
        imageUrl: q.imageUrl,
        imageUrls: Array.isArray(q.imageUrls) ? q.imageUrls : q.imageUrl ? [q.imageUrl] : [],
        isMathContent: q.isMathContent,
        answerFormat: q.answerFormat,
        options: {
          A: q.optionA,
          B: q.optionB,
          C: q.optionC,
          D: q.optionD,
          E: q.optionE,
        },
        complexStatements:
          q.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? Array.isArray((q.complexCorrectJson as any)?.statements)
              ? ((q.complexCorrectJson as any).statements as unknown[]).map((item) => String(item))
              : [q.optionC, q.optionD, q.optionE].filter((item): item is string => Boolean(item))
            : undefined,
        complexChoiceLabels:
          q.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? {
                left: String((q.complexCorrectJson as any)?.labels?.left ?? q.optionA ?? 'Benar'),
                right: String((q.complexCorrectJson as any)?.labels?.right ?? q.optionB ?? 'Salah'),
              }
            : undefined,
        shortAnswerType: q.shortAnswerType,
        savedAnswer: attemptMap.get(q.id)
          ? {
              selectedAnswer: attemptMap.get(q.id)?.selectedAnswer,
              shortAnswerText: attemptMap.get(q.id)?.shortAnswerText,
              selectedAnswers: attemptMap.get(q.id)?.selectedAnswersJson,
            }
          : null,
      })),
    };
  }

  private formatAnswer(question: any, attempt: any): string {
    const format = question.answerFormat as QuestionAnswerFormat;

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE) {
      return attempt?.selectedAnswer ?? '-';
    }

    if (format === QuestionAnswerFormat.SHORT_INPUT) {
      return attempt?.shortAnswerText ?? '-';
    }

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX) {
      const values = Array.isArray(attempt?.selectedAnswersJson) ? attempt.selectedAnswersJson : [];
      if (!values.length) {
        return '-';
      }

      const labels = {
        left: String(question?.complexCorrectJson?.labels?.left ?? question?.optionA ?? 'Benar'),
        right: String(question?.complexCorrectJson?.labels?.right ?? question?.optionB ?? 'Salah'),
      };

      return values
        .map((raw: unknown, idx: number) => {
          const value = String(raw);
          const human = value === 'LEFT' ? labels.left : value === 'RIGHT' ? labels.right : value;
          return `P${idx + 1}:${human}`;
        })
        .join(', ');
    }

    return '-';
  }

  private formatCorrectAnswer(question: any): string {
    const format = question.answerFormat as QuestionAnswerFormat;

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE) {
      return question.correctAnswer ?? '-';
    }

    if (format === QuestionAnswerFormat.SHORT_INPUT) {
      return question.shortAnswerKey ?? '-';
    }

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX) {
      const raw = question.complexCorrectJson;
      const values = Array.isArray(raw?.answers) ? raw.answers : Array.isArray(raw) ? raw : [];
      if (!values.length) {
        return '-';
      }

      const labels = {
        left: String(raw?.labels?.left ?? question?.optionA ?? 'Benar'),
        right: String(raw?.labels?.right ?? question?.optionB ?? 'Salah'),
      };

      return values
        .map((x: unknown, idx: number) => {
          const value = String(x);
          const human = value === 'LEFT' ? labels.left : value === 'RIGHT' ? labels.right : value;
          return `P${idx + 1}:${human}`;
        })
        .join(', ');
    }

    return '-';
  }

  private async buildReviewItems(examSessionId: string) {
    const [questions, attempts] = await Promise.all([
      this.prisma.question.findMany({
        where: { isActive: true },
        include: {
          subTest: true,
        },
        orderBy: [{ subTest: { orderIndex: 'asc' } }, { createdAt: 'asc' }],
      }),
      this.prisma.examAttempt.findMany({
        where: { examSessionId },
      }),
    ]);

    const attemptMap = new Map(attempts.map((item) => [item.questionId, item]));

    return questions.map((question, index) => {
      const attempt = attemptMap.get(question.id);
      const isAnswered =
        attempt?.selectedAnswer != null ||
        (attempt?.shortAnswerText != null && attempt.shortAnswerText.trim().length > 0) ||
        (Array.isArray(attempt?.selectedAnswersJson) && attempt.selectedAnswersJson.length > 0);

      return {
        attemptId: attempt?.id ?? `UNANSWERED-${question.id}`,
        questionId: question.id,
        subTestCode: question.subTest.code,
        subTestName: question.subTest.name,
        materialTopic: question.materialTopic,
        questionText: question.promptText,
        answerFormat: question.answerFormat,
        sequence: index + 1,
        userAnswer: this.formatAnswer(question, attempt),
        correctAnswer: this.formatCorrectAnswer(question),
        isCorrect: isAnswered ? (attempt?.isCorrect ?? null) : null,
        discussion: question.discussion,
      };
    });
  }

  private evaluateAttempt(question: any, attempt: SubmitAttemptDto): boolean {
    const format = question.answerFormat as QuestionAnswerFormat;

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE) {
      return Boolean(attempt.selectedAnswer && question.correctAnswer && attempt.selectedAnswer === question.correctAnswer);
    }

    if (format === QuestionAnswerFormat.SHORT_INPUT) {
      if (!attempt.shortAnswerText || !question.shortAnswerKey || !question.shortAnswerType) {
        return false;
      }

      if (question.shortAnswerType === ShortAnswerType.NUMERIC) {
        const submitted = Number(attempt.shortAnswerText);
        const expected = Number(question.shortAnswerKey);
        if (Number.isNaN(submitted) || Number.isNaN(expected)) {
          return false;
        }
        const tolerance = typeof question.shortAnswerTolerance === 'number' ? question.shortAnswerTolerance : 0;
        return Math.abs(submitted - expected) <= tolerance;
      }

      const submitted = attempt.shortAnswerText.trim();
      const expected = String(question.shortAnswerKey).trim();
      if (question.shortAnswerCaseSensitive) {
        return submitted === expected;
      }
      return submitted.toLowerCase() === expected.toLowerCase();
    }

    if (format === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX) {
      const submitted = (attempt.selectedAnswers ?? []).map((item) => String(item));
      const raw = question.complexCorrectJson;
      const expected = (Array.isArray(raw?.answers) ? raw.answers : Array.isArray(raw) ? raw : []).map((item: unknown) => String(item));
      if (!submitted.length || !expected.length) {
        return false;
      }

      if (submitted.length !== expected.length) {
        return false;
      }

      const hasBinaryExpected = expected.every((value: string) => value === 'LEFT' || value === 'RIGHT');
      if (hasBinaryExpected) {
        return submitted.every((value, idx) => value === expected[idx]);
      }

      const submittedSorted = [...submitted].sort();
      const expectedSorted = [...expected].sort();
      return submittedSorted.every((value, idx) => value === expectedSorted[idx]);
    }

    return false;
  }

  async setActiveQuestion(examSessionId: string, requesterUserId: string, questionId: string) {
    const session = await this.assertSessionOwner(examSessionId, requesterUserId);

    if (session.status !== ExamSessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Sesi ujian sudah selesai.');
    }

    const [question, activeProgress] = await Promise.all([
      this.prisma.question.findUnique({
        where: { id: questionId },
        select: { id: true, subTestId: true },
      }),
      this.prisma.sessionSectionProgress.findFirst({
        where: {
          examSessionId,
          status: 'ACTIVE',
        },
        include: {
          sectionSchedule: {
            select: { subTestId: true },
          },
        },
      }),
    ]);

    if (!question) {
      throw new NotFoundException(`Question ${questionId} not found.`);
    }

    if (!activeProgress || activeProgress.sectionSchedule.subTestId !== question.subTestId) {
      throw new ForbiddenException('Progress soal tidak sesuai dengan sub-tes aktif saat ini.');
    }

    await this.prisma.examSession.update({
      where: { id: examSessionId },
      data: {
        currentQuestionId: questionId,
      },
    });

    return { success: true };
  }

  async submitAttempt(dto: SubmitAttemptDto, requesterUserId: string) {
    const [session, question] = await Promise.all([
      this.assertSessionOwner(dto.examSessionId, requesterUserId),
      this.prisma.question.findUnique({ where: { id: dto.questionId } }),
    ]);

    if (session.status !== ExamSessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Sesi ujian sudah selesai dan tidak menerima jawaban baru.');
    }

    if (!question) {
      throw new NotFoundException(`Question ${dto.questionId} not found.`);
    }

    const activeProgress = await this.prisma.sessionSectionProgress.findFirst({
      where: {
        examSessionId: dto.examSessionId,
        status: 'ACTIVE',
      },
      include: {
        sectionSchedule: true,
      },
    });

    if (!activeProgress) {
      throw new ForbiddenException('Tidak ada sub-tes aktif untuk sesi ini.');
    }

    if (activeProgress.sectionSchedule.subTestId !== question.subTestId) {
      throw new ForbiddenException('Jawaban hanya bisa dikirim untuk sub-tes yang sedang aktif.');
    }

    const isCorrect = this.evaluateAttempt(question, dto);

    const saved = await this.prisma.examAttempt.upsert({
      where: {
        examSessionId_questionId: {
          examSessionId: dto.examSessionId,
          questionId: dto.questionId,
        },
      },
      update: {
        selectedAnswer: dto.selectedAnswer as any,
        shortAnswerText: dto.shortAnswerText ?? null,
        selectedAnswersJson: dto.selectedAnswers ? (dto.selectedAnswers as any) : undefined,
        isCorrect,
        answeredAt: new Date(),
      },
      create: {
        examSessionId: dto.examSessionId,
        questionId: dto.questionId,
        selectedAnswer: dto.selectedAnswer as any,
        shortAnswerText: dto.shortAnswerText ?? null,
        selectedAnswersJson: dto.selectedAnswers ? (dto.selectedAnswers as any) : undefined,
        isCorrect,
        answeredAt: new Date(),
      },
      select: {
        id: true,
        examSessionId: true,
        questionId: true,
        // Removed isCorrect to prevent data leakage (brute force vulnerability)
      },
    });

    return {
      success: true,
      attempt: saved,
    };
  }

  private async calculateAndPersistScoreSummary(examSessionId: string) {
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examSessionId,
      },
      include: {
        question: {
          include: {
            subTest: true,
          },
        },
      },
    });

    const summary: Record<string, { total: number; answered: number; correct: number; wrong: number }> = {};
    const byMaterial: Record<
      string,
      {
        subTestCode: string;
        subTestName: string;
        materialTopic: string;
        total: number;
        answered: number;
        correct: number;
        wrong: number;
      }
    > = {};

    const allSubTests = await this.prisma.subTest.findMany({ orderBy: { orderIndex: 'asc' } });
    for (const subTest of allSubTests) {
      summary[subTest.code] = { total: 0, answered: 0, correct: 0, wrong: 0 };
    }

    for (const item of attempts) {
      const recheck = this.evaluateAttempt(item.question, {
        examSessionId: item.examSessionId,
        questionId: item.questionId,
        selectedAnswer: item.selectedAnswer as any,
        shortAnswerText: item.shortAnswerText ?? undefined,
        selectedAnswers: (Array.isArray(item.selectedAnswersJson) ? item.selectedAnswersJson : []) as any,
      });

      if (item.isCorrect !== recheck) {
        await this.prisma.examAttempt.update({
          where: { id: item.id },
          data: { isCorrect: recheck },
        });
      }

      const key = item.question.subTest.code;
      summary[key].total += 1;
      const isAnswered =
        item.selectedAnswer != null ||
        (item.shortAnswerText != null && item.shortAnswerText.trim().length > 0) ||
        (Array.isArray(item.selectedAnswersJson) && item.selectedAnswersJson.length > 0);
      if (isAnswered) {
        summary[key].answered += 1;
      }
      if (recheck) {
        summary[key].correct += 1;
      }

      const materialTopic = item.question.materialTopic?.trim();
      if (materialTopic) {
        const materialKey = `${item.question.subTest.code}::${materialTopic.toLowerCase()}`;
        if (!byMaterial[materialKey]) {
          byMaterial[materialKey] = {
            subTestCode: item.question.subTest.code,
            subTestName: item.question.subTest.name,
            materialTopic,
            total: 0,
            answered: 0,
            correct: 0,
            wrong: 0,
          };
        }

        byMaterial[materialKey].total += 1;
        if (isAnswered) {
          byMaterial[materialKey].answered += 1;
        }
        if (recheck) {
          byMaterial[materialKey].correct += 1;
        }
      }
    }

    Object.keys(summary).forEach((subTestCode) => {
      summary[subTestCode].wrong = summary[subTestCode].answered - summary[subTestCode].correct;
    });

    Object.keys(byMaterial).forEach((key) => {
      byMaterial[key].wrong = byMaterial[key].answered - byMaterial[key].correct;
    });

    const weakMaterials = Object.values(byMaterial)
      .map((item) => ({
        ...item,
        accuracy: item.answered > 0 ? item.correct / item.answered : 0,
      }))
      .filter((item) => item.answered > 0 && item.wrong > 0)
      .sort((a, b) => {
        if (a.accuracy !== b.accuracy) {
          return a.accuracy - b.accuracy;
        }
        return b.wrong - a.wrong;
      })
      .slice(0, 8);

    const totalCorrect = Object.values(summary).reduce((sum, item) => sum + item.correct, 0);
    const totalAnswered = Object.values(summary).reduce((sum, item) => sum + item.answered, 0);

    await this.prisma.examSession.update({
      where: { id: examSessionId },
      data: {
        scoreSummaryJson: {
          bySubTest: summary,
          weakMaterials,
          totals: {
            correct: totalCorrect,
            answered: totalAnswered,
            wrong: totalAnswered - totalCorrect,
          },
        } as any,
      },
    });

    return {
      bySubTest: summary,
      weakMaterials,
      totals: {
        correct: totalCorrect,
        answered: totalAnswered,
        wrong: totalAnswered - totalCorrect,
      },
    };
  }

  async processScoreSessionJob(examSessionId: string, requesterUserId: string) {
    await this.assertSessionOwner(examSessionId, requesterUserId);
    return this.calculateAndPersistScoreSummary(examSessionId);
  }

  async scoreSession(dto: ScoreSessionDto, requesterUserId: string) {
    await this.assertSessionOwner(dto.examSessionId, requesterUserId);

    const enqueued = await this.scoringQueueService.enqueueScoreSessionJob({
      examSessionId: dto.examSessionId,
      requesterUserId,
      requestedAt: new Date().toISOString(),
    });

    return {
      success: true,
      queued: true,
      examSessionId: dto.examSessionId,
      message: 'Jawaban kamu sedang diproses, hasilnya akan segera muncul.',
      queueMessageId: enqueued.messageId,
    };
  }

  async completeSession(examSessionId: string, requesterUserId: string) {
    const session = await this.assertSessionOwner(examSessionId, requesterUserId);

    if (session.status !== ExamSessionStatus.AUTO_SUBMITTED) {
      await this.prisma.examSession.update({
        where: { id: examSessionId },
        data: {
          status: ExamSessionStatus.SUBMITTED,
          submittedAt: session.submittedAt ?? new Date(),
        },
      });
    }

    const scoreSummary = await this.calculateAndPersistScoreSummary(examSessionId);
    const reviewItems = await this.buildReviewItems(examSessionId);

    return {
      success: true,
      examSessionId,
      scoreSummary,
      reviewItems,
      participantProfile: await this.prisma.examSession.findUnique({
        where: { id: examSessionId },
        select: {
          participantAccessTokenId: true,
          participantName: true,
          participantCongregation: true,
          participantSchool: true,
        },
      }),
    };
  }

  async getSessionResult(examSessionId: string, requesterUserId: string) {
    await this.assertSessionOwner(examSessionId, requesterUserId);

    const session = await this.prisma.examSession.findUnique({
      where: { id: examSessionId },
      select: {
        id: true,
        status: true,
        scoreSummaryJson: true,
        participantAccessTokenId: true,
        participantName: true,
        participantCongregation: true,
        participantSchool: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${examSessionId} not found.`);
    }

    if (session.status === ExamSessionStatus.IN_PROGRESS || session.status === ExamSessionStatus.NOT_STARTED) {
      throw new ForbiddenException('Hasil tidak dapat dilihat sebelum sesi diselesaikan.');
    }

    const reviewItems = await this.buildReviewItems(examSessionId);

    return {
      success: true,
      examSessionId,
      status: session.status,
      scoreSummary: session.scoreSummaryJson,
      participantProfile: {
        tokenId: session.participantAccessTokenId,
        fullName: session.participantName,
        congregation: session.participantCongregation,
        schoolName: session.participantSchool,
      },
      reviewItems,
    };
  }

  async recordProctoringEvent(dto: ProctoringEventDto, requesterUserId: string) {
    const session = await this.assertSessionOwner(dto.sessionId, requesterUserId);

    const shouldIncrement = VIOLATION_TYPES.includes(dto.eventType);

    return this.prisma.$transaction(async (tx: any) => {
      let warningCount = session.warningCount;

      if (shouldIncrement) {
        const updated = await tx.examSession.update({
          where: { id: dto.sessionId },
          data: {
            warningCount: {
              increment: 1,
            },
          },
          select: { warningCount: true },
        });
        warningCount = updated.warningCount;
      }

      await tx.proctoringEvent.create({
        data: {
          examSessionId: dto.sessionId,
          eventType: dto.eventType,
          warningNumber: shouldIncrement ? warningCount : null,
          metadataJson: dto.metadata as any,
          occurredAt: dto.clientTimestamp ? new Date(dto.clientTimestamp) : new Date(),
        },
      });

      const shouldForceSubmit = warningCount >= 3;
      if (shouldForceSubmit) {
        const finalState = await this.applyForceSubmit(tx, {
          sessionId: dto.sessionId,
          warningCount,
          reason: 'TAB_SWITCH_LIMIT_EXCEEDED',
        });
        return {
          success: true,
          warningCount,
          shouldForceSubmit,
          sessionStatus: finalState.status,
          submittedAt: finalState.submittedAt,
        };
      }

      return {
        success: true,
        warningCount,
        shouldForceSubmit,
        sessionStatus: session.status,
      };
    });
  }

  private async applyForceSubmit(
    tx: any,
    dto: ForceSubmitDto,
  ) {
    const current = await tx.examSession.findUnique({ where: { id: dto.sessionId } });
    if (!current) {
      throw new NotFoundException(`Session ${dto.sessionId} not found.`);
    }

    if (
      current.status === ExamSessionStatus.SUBMITTED ||
      current.status === ExamSessionStatus.AUTO_SUBMITTED ||
      current.status === ExamSessionStatus.EXPIRED
    ) {
      return {
        id: current.id,
        status: current.status,
        submittedAt: current.submittedAt,
        warningCount: current.warningCount,
      };
    }

    const updated = await tx.examSession.update({
      where: { id: dto.sessionId },
      data: {
        status: ExamSessionStatus.AUTO_SUBMITTED,
        forceSubmitted: true,
        submittedAt: new Date(),
        warningCount: dto.warningCount ?? current.warningCount,
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        warningCount: true,
      },
    });

    await tx.proctoringEvent.create({
      data: {
        examSessionId: dto.sessionId,
        eventType: ProctoringEventType.FORCE_SUBMIT_TRIGGERED,
        warningNumber: updated.warningCount,
        metadataJson: {
          reason: dto.reason,
        },
      },
    });

    return updated;
  }

  async forceSubmit(dto: ForceSubmitDto, requesterUserId: string) {
    await this.assertSessionOwner(dto.sessionId, requesterUserId);

    const result = await this.prisma.$transaction((tx: any) => this.applyForceSubmit(tx, dto));
    return {
      success: true,
      sessionId: dto.sessionId,
      status: result.status,
      warningCount: result.warningCount,
      reason: dto.reason,
      submittedAt: result.submittedAt,
    };
  }

  async submitFinal(examSessionId: string, requesterUserId: string) {
    const session = await this.assertSessionOwner(examSessionId, requesterUserId);

    if (session.status === ExamSessionStatus.AUTO_SUBMITTED) {
      return this.completeSession(examSessionId, requesterUserId);
    }

    await this.prisma.examSession.update({
      where: { id: examSessionId },
      data: {
        status: ExamSessionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });

    return this.completeSession(examSessionId, requesterUserId);
  }

  async getLatestCompletedSession(requesterUserId: string) {
    const session = await this.prisma.examSession.findFirst({
      where: {
        userId: requesterUserId,
        status: {
          in: [ExamSessionStatus.SUBMITTED, ExamSessionStatus.AUTO_SUBMITTED, ExamSessionStatus.EXPIRED],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        scoreSummaryJson: true,
        submittedAt: true,
        createdAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Tidak ada sesi ujian yang sudah selesai.');
    }

    // If no score summary, try scoring it first
    if (!session.scoreSummaryJson) {
      try {
        await this.calculateAndPersistScoreSummary(session.id);
        const updated = await this.prisma.examSession.findUnique({
          where: { id: session.id },
          select: { scoreSummaryJson: true },
        });
        session.scoreSummaryJson = updated?.scoreSummaryJson ?? null;
      } catch {
        // scoring failed, return what we have
      }
    }

    const reviewItems = await this.buildReviewItems(session.id);

    return {
      success: true,
      examSessionId: session.id,
      status: session.status,
      scoreSummary: session.scoreSummaryJson ?? {
        bySubTest: {},
        totals: { correct: 0, wrong: 0, answered: 0 },
      },
      reviewItems,
      submittedAt: session.submittedAt?.toISOString() ?? null,
    };
  }
}
