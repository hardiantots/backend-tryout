import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PermissionCode } from '../access/access.types';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ListQuestionsDto } from './dto/list-questions.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionAnswerFormat, ShortAnswerType } from './question.types';

@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessService,
    private readonly s3Service: S3Service,
  ) {}

  private canCreateQuestionForSubTest(
    effective: {
      permissions: string[];
      scopes: Record<string, { global: boolean; subTestIds: string[] }>;
    },
    subTestId: string,
  ) {
    if (!effective.permissions.includes(PermissionCode.QUESTION_CREATE)) {
      return false;
    }

    const scope = effective.scopes[PermissionCode.QUESTION_CREATE];
    if (!scope) {
      return false;
    }

    if (scope.global) {
      return true;
    }

    return Array.isArray(scope.subTestIds) && scope.subTestIds.includes(subTestId);
  }

  private hasScopedPermission(
    effective: {
      permissions: string[];
      scopes: Record<string, { global: boolean; subTestIds: string[] }>;
    },
    permissionCode: PermissionCode,
    subTestId: string,
  ) {
    if (!effective.permissions.includes(permissionCode)) {
      return false;
    }

    const scope = effective.scopes[permissionCode];
    if (!scope) {
      return false;
    }

    if (scope.global) {
      return true;
    }

    return Array.isArray(scope.subTestIds) && scope.subTestIds.includes(subTestId);
  }

  private validateByFormat(dto: CreateQuestionDto) {
    if (dto.imageUrls && dto.imageUrls.length > 3) {
      throw new BadRequestException('Maksimal 3 gambar per soal.');
    }

    if (dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_SINGLE) {
      if (!dto.correctAnswer) {
        throw new BadRequestException('correctAnswer is required for MULTIPLE_CHOICE_SINGLE.');
      }
      if (!dto.optionA || !dto.optionB || !dto.optionC || !dto.optionD || !dto.optionE) {
        throw new BadRequestException('optionA-optionE are required for MULTIPLE_CHOICE_SINGLE.');
      }
    }

    if (dto.answerFormat === QuestionAnswerFormat.SHORT_INPUT) {
      if (!dto.shortAnswerType || !dto.shortAnswerKey) {
        throw new BadRequestException('shortAnswerType and shortAnswerKey are required for SHORT_INPUT.');
      }
      if (dto.shortAnswerType === ShortAnswerType.NUMERIC && dto.shortAnswerTolerance == null) {
        throw new BadRequestException('shortAnswerTolerance is recommended for NUMERIC short input questions.');
      }
    }

    if (dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX) {
      if (!dto.complexStatements || dto.complexStatements.length < 3 || dto.complexStatements.length > 4) {
        throw new BadRequestException('complexStatements wajib berisi 3 atau 4 pernyataan.');
      }
      if (!dto.complexOptionLeftLabel?.trim() || !dto.complexOptionRightLabel?.trim()) {
        throw new BadRequestException('complexOptionLeftLabel dan complexOptionRightLabel wajib diisi.');
      }
      if (!dto.complexCorrectAnswers || dto.complexCorrectAnswers.length !== dto.complexStatements.length) {
        throw new BadRequestException('Jumlah complexCorrectAnswers harus sama dengan jumlah complexStatements.');
      }
      if (dto.complexCorrectAnswers.some((item) => item !== 'LEFT' && item !== 'RIGHT')) {
        throw new BadRequestException('Nilai complexCorrectAnswers hanya boleh LEFT atau RIGHT.');
      }
    }
  }

  async createQuestion(actorUserId: string, dto: CreateQuestionDto) {
    this.validateByFormat(dto);

    const [user, subTest] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorUserId } }),
      this.prisma.subTest.findUnique({ where: { id: dto.subTestId } }),
    ]);

    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    if (!subTest) {
      throw new NotFoundException('SubTest not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    if (!this.canCreateQuestionForSubTest(effective as any, dto.subTestId)) {
      throw new ForbiddenException('You do not have QUESTION_CREATE permission for this sub-test scope.');
    }

    const created = await this.prisma.question.create({
      data: {
        subTestId: dto.subTestId,
        createdById: actorUserId,
        promptText: dto.promptText,
        materialTopic: dto.materialTopic?.trim() || null,
        imageUrl: dto.imageUrl ?? dto.imageUrls?.[0] ?? null,
        imageUrls: dto.imageUrls ? (dto.imageUrls as any) : undefined,
        isMathContent: dto.isMathContent ?? false,
        answerFormat: dto.answerFormat as any,
        optionA:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexOptionLeftLabel?.trim() ?? null
            : dto.optionA ?? null,
        optionB:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexOptionRightLabel?.trim() ?? null
            : dto.optionB ?? null,
        optionC:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[0]?.trim() ?? null
            : dto.optionC ?? null,
        optionD:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[1]?.trim() ?? null
            : dto.optionD ?? null,
        optionE:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[2]?.trim() ?? null
            : dto.optionE ?? null,
        correctAnswer: dto.correctAnswer as any,
        complexCorrectJson:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? ({
                statements: dto.complexStatements?.map((item) => item.trim()) ?? [],
                labels: {
                  left: dto.complexOptionLeftLabel?.trim() ?? 'Benar',
                  right: dto.complexOptionRightLabel?.trim() ?? 'Salah',
                },
                answers: dto.complexCorrectAnswers ?? [],
              } as any)
            : undefined,
        shortAnswerType: (dto.shortAnswerType as any) ?? null,
        shortAnswerKey: dto.shortAnswerKey ?? null,
        shortAnswerTolerance: dto.shortAnswerTolerance ?? null,
        shortAnswerCaseSensitive: dto.shortAnswerCaseSensitive ?? false,
        discussion: dto.discussion,
      },
      select: {
        id: true,
        subTestId: true,
        answerFormat: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      question: created,
    };
  }

  async getWritableSubTests(actorUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    const createScope = effective.scopes[PermissionCode.QUESTION_CREATE];
    const updateScope = effective.scopes[PermissionCode.QUESTION_UPDATE];
    const canCreate = effective.permissions.includes(PermissionCode.QUESTION_CREATE) && !!createScope;
    const canUpdate = effective.permissions.includes(PermissionCode.QUESTION_UPDATE) && !!updateScope;

    if (!canCreate && !canUpdate) {
      throw new ForbiddenException('QUESTION_CREATE atau QUESTION_UPDATE permission is required.');
    }

    const global = Boolean(createScope?.global || updateScope?.global);
    const scopedIds = Array.from(new Set([...(createScope?.subTestIds ?? []), ...(updateScope?.subTestIds ?? [])]));

    const where = global
      ? undefined
      : {
          id: {
            in: scopedIds,
          },
        };

    const subTests = await this.prisma.subTest.findMany({
      where,
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        component: true,
      },
    });

    return {
      success: true,
      subTests: subTests.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        componentType: item.component,
      })),
    };
  }

  async getQuestionImageUploadUrl(actorUserId: string, dto: RequestUploadUrlDto) {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    const subTest = await this.prisma.subTest.findUnique({ where: { id: dto.subTestId } });
    if (!subTest) {
      throw new NotFoundException('SubTest not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    if (!this.canCreateQuestionForSubTest(effective as any, dto.subTestId)) {
      throw new ForbiddenException('You do not have QUESTION_CREATE permission for this sub-test scope.');
    }

    const mime = dto.mimeType.toLowerCase();
    const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMime.has(mime)) {
      throw new BadRequestException('Only JPG, PNG, and WEBP images are allowed.');
    }

    const parsedMax = Number(process.env.MAX_FILE_SIZE ?? 5 * 1024 * 1024);
    const maxBytes = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : 5 * 1024 * 1024;
    if (dto.sizeBytes > maxBytes) {
      throw new BadRequestException(`Image size exceeds ${(maxBytes / (1024 * 1024)).toFixed(2)}MB limit.`);
    }

    const { uploadUrl, publicUrl, objectKey, expiresInSeconds } = await this.s3Service.generateUploadUrl({
      subTestId: dto.subTestId,
      fileName: dto.fileName,
      mimeType: mime,
      expiresInSeconds: 300,
    });

    return {
      success: true,
      uploadUrl,
      publicUrl,
      objectKey,
      expiresInSeconds,
      maxSizeBytes: maxBytes,
    };
  }

  async listQuestions(actorUserId: string, dto: ListQuestionsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    const subTest = await this.prisma.subTest.findUnique({ where: { id: dto.subTestId } });
    if (!subTest) {
      throw new NotFoundException('SubTest not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    const allowed =
      this.hasScopedPermission(effective as any, PermissionCode.QUESTION_CREATE, dto.subTestId) ||
      this.hasScopedPermission(effective as any, PermissionCode.QUESTION_UPDATE, dto.subTestId);

    if (!allowed) {
      throw new ForbiddenException('You do not have permission to view/manage questions in this sub-test scope.');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 5;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.question.findMany({
        where: {
          subTestId: dto.subTestId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: pageSize,
      }),
      this.prisma.question.count({
        where: {
          subTestId: dto.subTestId,
          isActive: true,
        },
      }),
    ]);

    return {
      success: true,
      items: items.map((item) => ({
        id: item.id,
        subTestId: item.subTestId,
        promptText: item.promptText,
        materialTopic: item.materialTopic,
        imageUrl: item.imageUrl,
        imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [],
        isMathContent: item.isMathContent,
        answerFormat: item.answerFormat,
        optionA: item.optionA,
        optionB: item.optionB,
        optionC: item.optionC,
        optionD: item.optionD,
        optionE: item.optionE,
        correctAnswer: item.correctAnswer,
        complexStatements: Array.isArray((item.complexCorrectJson as any)?.statements)
          ? ((item.complexCorrectJson as any).statements as unknown[]).map((x) => String(x))
          : [item.optionC, item.optionD, item.optionE].filter((x): x is string => Boolean(x)),
        complexOptionLeftLabel: String((item.complexCorrectJson as any)?.labels?.left ?? item.optionA ?? 'Benar'),
        complexOptionRightLabel: String((item.complexCorrectJson as any)?.labels?.right ?? item.optionB ?? 'Salah'),
        complexCorrectAnswers: Array.isArray((item.complexCorrectJson as any)?.answers)
          ? ((item.complexCorrectJson as any).answers as unknown[]).map((x) => String(x))
          : Array.isArray(item.complexCorrectJson)
            ? (item.complexCorrectJson as unknown[]).map((x) => String(x))
            : [],
        shortAnswerType: item.shortAnswerType,
        shortAnswerKey: item.shortAnswerKey,
        shortAnswerTolerance: item.shortAnswerTolerance,
        shortAnswerCaseSensitive: item.shortAnswerCaseSensitive,
        discussion: item.discussion,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async updateQuestion(actorUserId: string, dto: UpdateQuestionDto) {
    this.validateByFormat(dto);

    const [user, existing] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorUserId } }),
      this.prisma.question.findUnique({ where: { id: dto.questionId } }),
    ]);

    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    if (!existing) {
      throw new NotFoundException('Question not found.');
    }

    if (dto.subTestId !== existing.subTestId) {
      throw new BadRequestException('SubTest soal tidak boleh diubah saat edit.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    const allowed = this.hasScopedPermission(effective as any, PermissionCode.QUESTION_UPDATE, existing.subTestId);

    if (!allowed) {
      throw new ForbiddenException('You do not have QUESTION_UPDATE permission for this sub-test scope.');
    }

    const updated = await this.prisma.question.update({
      where: { id: dto.questionId },
      data: {
        promptText: dto.promptText,
        materialTopic: dto.materialTopic?.trim() || null,
        imageUrl: dto.imageUrl ?? dto.imageUrls?.[0] ?? null,
        imageUrls: dto.imageUrls ? (dto.imageUrls as any) : undefined,
        isMathContent: dto.isMathContent ?? false,
        answerFormat: dto.answerFormat as any,
        optionA:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexOptionLeftLabel?.trim() ?? null
            : dto.optionA ?? null,
        optionB:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexOptionRightLabel?.trim() ?? null
            : dto.optionB ?? null,
        optionC:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[0]?.trim() ?? null
            : dto.optionC ?? null,
        optionD:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[1]?.trim() ?? null
            : dto.optionD ?? null,
        optionE:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? dto.complexStatements?.[2]?.trim() ?? null
            : dto.optionE ?? null,
        correctAnswer: dto.correctAnswer as any,
        complexCorrectJson:
          dto.answerFormat === QuestionAnswerFormat.MULTIPLE_CHOICE_COMPLEX
            ? ({
                statements: dto.complexStatements?.map((item) => item.trim()) ?? [],
                labels: {
                  left: dto.complexOptionLeftLabel?.trim() ?? 'Benar',
                  right: dto.complexOptionRightLabel?.trim() ?? 'Salah',
                },
                answers: dto.complexCorrectAnswers ?? [],
              } as any)
            : undefined,
        shortAnswerType: (dto.shortAnswerType as any) ?? null,
        shortAnswerKey: dto.shortAnswerKey ?? null,
        shortAnswerTolerance: dto.shortAnswerTolerance ?? null,
        shortAnswerCaseSensitive: dto.shortAnswerCaseSensitive ?? false,
        discussion: dto.discussion,
      },
      select: {
        id: true,
        subTestId: true,
        answerFormat: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      question: updated,
    };
  }

  async deleteQuestion(actorUserId: string, questionId: string) {
    const [user, existing] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorUserId } }),
      this.prisma.question.findUnique({ where: { id: questionId } }),
    ]);

    if (!user) {
      throw new NotFoundException('Actor user not found.');
    }

    if (!existing) {
      throw new NotFoundException('Question not found.');
    }

    const effective = await this.accessService.getEffectivePermissions(actorUserId);
    const allowed = this.hasScopedPermission(effective as any, PermissionCode.QUESTION_DELETE, existing.subTestId);

    if (!allowed) {
      throw new ForbiddenException('You do not have QUESTION_DELETE permission for this sub-test scope.');
    }

    if (!existing.isActive) {
      return {
        success: true,
        deleted: true,
        alreadyDeleted: true,
        questionId: existing.id,
      };
    }

    const deleted = await this.prisma.question.update({
      where: { id: existing.id },
      data: {
        isActive: false,
      },
      select: {
        id: true,
        subTestId: true,
        isActive: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      deleted: true,
      question: deleted,
    };
  }
}
