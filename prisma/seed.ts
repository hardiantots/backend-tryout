import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

type ComponentType = 'TPS' | 'LITERASI';
type UserRoleCode = 'MASTER_ADMIN' | 'ADMIN' | 'PARTICIPANT';
type PermissionCode =
  | 'QUESTION_CREATE'
  | 'QUESTION_UPDATE'
  | 'QUESTION_DELETE'
  | 'QUESTION_VIEW_DRAFT'
  | 'QUESTION_PUBLISH'
  | 'QUESTION_REVIEW'
  | 'SUBTEST_VIEW'
  | 'EXAM_RESULT_VIEW'
  | 'EXAM_RESULT_EXPORT'
  | 'USER_VIEW'
  | 'USER_SUSPEND'
  | 'ADMIN_ROLE_ASSIGN'
  | 'ADMIN_ROLE_REVOKE'
  | 'ADMIN_PERMISSION_GRANT'
  | 'ADMIN_PERMISSION_REVOKE'
  | 'AUDIT_LOG_VIEW';

const ComponentType = {
  TPS: 'TPS' as ComponentType,
  LITERASI: 'LITERASI' as ComponentType,
};

const UserRoleCode = {
  MASTER_ADMIN: 'MASTER_ADMIN' as UserRoleCode,
  ADMIN: 'ADMIN' as UserRoleCode,
  PARTICIPANT: 'PARTICIPANT' as UserRoleCode,
};

const PermissionCode = {
  QUESTION_CREATE: 'QUESTION_CREATE' as PermissionCode,
  QUESTION_UPDATE: 'QUESTION_UPDATE' as PermissionCode,
  QUESTION_DELETE: 'QUESTION_DELETE' as PermissionCode,
  QUESTION_VIEW_DRAFT: 'QUESTION_VIEW_DRAFT' as PermissionCode,
  QUESTION_PUBLISH: 'QUESTION_PUBLISH' as PermissionCode,
  QUESTION_REVIEW: 'QUESTION_REVIEW' as PermissionCode,
  SUBTEST_VIEW: 'SUBTEST_VIEW' as PermissionCode,
  EXAM_RESULT_VIEW: 'EXAM_RESULT_VIEW' as PermissionCode,
  EXAM_RESULT_EXPORT: 'EXAM_RESULT_EXPORT' as PermissionCode,
  USER_VIEW: 'USER_VIEW' as PermissionCode,
  USER_SUSPEND: 'USER_SUSPEND' as PermissionCode,
  ADMIN_ROLE_ASSIGN: 'ADMIN_ROLE_ASSIGN' as PermissionCode,
  ADMIN_ROLE_REVOKE: 'ADMIN_ROLE_REVOKE' as PermissionCode,
  ADMIN_PERMISSION_GRANT: 'ADMIN_PERMISSION_GRANT' as PermissionCode,
  ADMIN_PERMISSION_REVOKE: 'ADMIN_PERMISSION_REVOKE' as PermissionCode,
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW' as PermissionCode,
};

const prisma = new PrismaClient();

const subTests = [
  { code: 'PU_INDUKTIF', name: 'Penalaran Umum - Induktif', component: ComponentType.TPS, orderIndex: 1, durationSeconds: 600 },
  { code: 'PU_DEDUKTIF', name: 'Penalaran Umum - Deduktif', component: ComponentType.TPS, orderIndex: 2, durationSeconds: 600 },
  { code: 'PU_KUANTITATIF', name: 'Penalaran Umum - Kuantitatif', component: ComponentType.TPS, orderIndex: 3, durationSeconds: 600 },
  { code: 'PPU', name: 'Pengetahuan dan Pemahaman Umum', component: ComponentType.TPS, orderIndex: 4, durationSeconds: 900 },
  { code: 'PBM', name: 'Pemahaman Bacaan dan Menulis', component: ComponentType.TPS, orderIndex: 5, durationSeconds: 1500 },
  { code: 'PK', name: 'Pengetahuan Kuantitatif', component: ComponentType.TPS, orderIndex: 6, durationSeconds: 1200 },
  { code: 'LIT_ID', name: 'Literasi Bahasa Indonesia', component: ComponentType.LITERASI, orderIndex: 7, durationSeconds: 2550 },
  { code: 'LIT_EN', name: 'Literasi Bahasa Inggris', component: ComponentType.LITERASI, orderIndex: 8, durationSeconds: 1200 },
  { code: 'PM', name: 'Penalaran Matematika', component: ComponentType.LITERASI, orderIndex: 9, durationSeconds: 2550 },
];

const roleDefinitions = [
  { code: UserRoleCode.MASTER_ADMIN, name: 'Master Admin', description: 'Can manage roles, permissions, and all operational features.' },
  { code: UserRoleCode.ADMIN, name: 'Admin', description: 'Operational user with scoped content permissions.' },
  { code: UserRoleCode.PARTICIPANT, name: 'Participant', description: 'Exam participant role.' },
];

const permissionDefinitions = [
  PermissionCode.QUESTION_CREATE,
  PermissionCode.QUESTION_UPDATE,
  PermissionCode.QUESTION_DELETE,
  PermissionCode.QUESTION_VIEW_DRAFT,
  PermissionCode.QUESTION_PUBLISH,
  PermissionCode.QUESTION_REVIEW,
  PermissionCode.SUBTEST_VIEW,
  PermissionCode.EXAM_RESULT_VIEW,
  PermissionCode.EXAM_RESULT_EXPORT,
  PermissionCode.USER_VIEW,
  PermissionCode.USER_SUSPEND,
  PermissionCode.ADMIN_ROLE_ASSIGN,
  PermissionCode.ADMIN_ROLE_REVOKE,
  PermissionCode.ADMIN_PERMISSION_GRANT,
  PermissionCode.ADMIN_PERMISSION_REVOKE,
  PermissionCode.AUDIT_LOG_VIEW,
];

const adminDefaultPermissions: PermissionCode[] = [
  PermissionCode.SUBTEST_VIEW,
  PermissionCode.QUESTION_VIEW_DRAFT,
  PermissionCode.QUESTION_CREATE,
  PermissionCode.QUESTION_UPDATE,
];

const dummyQuestionTargets: Record<string, number> = {
  PU_INDUKTIF: 10,
  PU_DEDUKTIF: 10,
  PU_KUANTITATIF: 10,
  PPU: 20,
  PBM: 20,
  PK: 20,
  LIT_ID: 30,
  LIT_EN: 20,
  PM: 20,
};

async function seedSubTestsAndSchedule() {
  for (const item of subTests) {
    const subTest = await prisma.subTest.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        component: item.component,
        orderIndex: item.orderIndex,
        isActive: true,
      },
      create: {
        code: item.code,
        name: item.name,
        component: item.component,
        orderIndex: item.orderIndex,
      },
    });

    await prisma.sectionSchedule.upsert({
      where: { subTestId: subTest.id },
      update: {
        orderIndex: item.orderIndex,
        durationSeconds: item.durationSeconds,
        isLockedNavigation: true,
        isActive: true,
      },
      create: {
        subTestId: subTest.id,
        orderIndex: item.orderIndex,
        durationSeconds: item.durationSeconds,
        isLockedNavigation: true,
        isActive: true,
      },
    });
  }
}

async function seedRolesAndPermissions() {
  for (const role of roleDefinitions) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  for (const code of permissionDefinitions) {
    await prisma.permission.upsert({
      where: { code },
      update: {
        name: code,
        description: `Permission ${code}`,
      },
      create: {
        code,
        name: code,
        description: `Permission ${code}`,
      },
    });
  }

  const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.MASTER_ADMIN } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.ADMIN } });
  const allPermissions = await prisma.permission.findMany({});

  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: masterRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: masterRole.id,
        permissionId: permission.id,
      },
    });
  }

  const adminPermissions = allPermissions.filter((p: { code: PermissionCode }) => adminDefaultPermissions.includes(p.code));
  for (const permission of adminPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }
}

async function ensureSeedQuestionAuthor() {
  const email = 'seed.admin@snbt.local';
  const passwordHash = await argon2.hash('SeedAdmin2026!');

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName: 'Seed Question Admin',
      passwordHash,
      isEmailVerified: true,
    },
    create: {
      fullName: 'Seed Question Admin',
      email,
      passwordHash,
      isEmailVerified: true,
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.ADMIN } });
  const activeAdminRole = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      roleId: adminRole.id,
      revokedAt: null,
    },
  });

  if (!activeAdminRole) {
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id,
        assignedByUserId: user.id,
      },
    });
  }

  return user;
}

function isQuantitativeSubTest(code: string) {
  return code === 'PU_KUANTITATIF' || code === 'PK' || code === 'PM';
}

function chooseQuestionFormat(index: number): 'MULTIPLE_CHOICE_SINGLE' | 'SHORT_INPUT' | 'MULTIPLE_CHOICE_COMPLEX' {
  if (index % 8 === 0) {
    return 'MULTIPLE_CHOICE_COMPLEX';
  }
  if (index % 5 === 0) {
    return 'SHORT_INPUT';
  }
  return 'MULTIPLE_CHOICE_SINGLE';
}

function buildSingleChoiceQuestion(subTestCode: string, subTestName: string, index: number) {
  const base = (index % 7) + 3;
  const prompt = `SNBT 2026 - ${subTestName}: Tentukan pilihan paling tepat untuk skenario nomor ${index + 1}.`;

  return {
    answerFormat: 'MULTIPLE_CHOICE_SINGLE' as const,
    promptText: prompt,
    materialTopic: `Topik ${subTestCode} ${Math.floor(index / 5) + 1}`,
    optionA: `Pernyataan A untuk kasus ${index + 1}`,
    optionB: `Pernyataan B untuk kasus ${index + 1}`,
    optionC: `Pernyataan C untuk kasus ${index + 1}`,
    optionD: `Pernyataan D untuk kasus ${index + 1}`,
    optionE: `Pernyataan E untuk kasus ${index + 1}`,
    correctAnswer: (['A', 'B', 'C', 'D', 'E'][index % 5] as 'A' | 'B' | 'C' | 'D' | 'E'),
    discussion: `Pembahasan ${subTestCode} nomor ${index + 1}: lakukan eliminasi opsi yang tidak konsisten dengan informasi soal.`,
    shortAnswerType: null,
    shortAnswerKey: null,
    shortAnswerTolerance: null,
    shortAnswerCaseSensitive: false,
    complexCorrectJson: null,
    isMathContent: isQuantitativeSubTest(subTestCode) && base % 2 === 0,
  };
}

function buildShortInputQuestion(subTestCode: string, subTestName: string, index: number) {
  if (isQuantitativeSubTest(subTestCode)) {
    const a = 12 + (index % 8);
    const b = 5 + (index % 6);
    const result = a * b;
    return {
      answerFormat: 'SHORT_INPUT' as const,
      promptText: `SNBT 2026 - ${subTestName}: hitung nilai ${a} x ${b}.`,
      materialTopic: `Aritmetika Dasar ${subTestCode}`,
      optionA: null,
      optionB: null,
      optionC: null,
      optionD: null,
      optionE: null,
      correctAnswer: null,
      discussion: `Gunakan perkalian langsung: ${a} x ${b} = ${result}.`,
      shortAnswerType: 'NUMERIC' as const,
      shortAnswerKey: String(result),
      shortAnswerTolerance: 0,
      shortAnswerCaseSensitive: false,
      complexCorrectJson: null,
      isMathContent: true,
    };
  }

  return {
    answerFormat: 'SHORT_INPUT' as const,
    promptText: `SNBT 2026 - ${subTestName}: tulis kata kunci utama dari paragraf simulasi nomor ${index + 1}.`,
    materialTopic: `Pemahaman teks ${subTestCode}`,
    optionA: null,
    optionB: null,
    optionC: null,
    optionD: null,
    optionE: null,
    correctAnswer: null,
    discussion: 'Jawaban singkat menekankan identifikasi ide pokok secara ringkas dan tepat.',
    shortAnswerType: 'TEXT' as const,
    shortAnswerKey: 'ide pokok',
    shortAnswerTolerance: null,
    shortAnswerCaseSensitive: false,
    complexCorrectJson: null,
    isMathContent: false,
  };
}

function buildComplexQuestion(subTestCode: string, subTestName: string, index: number) {
  const statementCount = index % 2 === 0 ? 4 : 3;
  const statements = Array.from({ length: statementCount }, (_, i) =>
    `Pernyataan ${i + 1} pada konteks ${subTestCode} nomor ${index + 1}.`,
  );
  const answers = statements.map((_, i) => ((i + index) % 2 === 0 ? 'LEFT' : 'RIGHT'));

  return {
    answerFormat: 'MULTIPLE_CHOICE_COMPLEX' as const,
    promptText: `SNBT 2026 - ${subTestName}: nilai setiap pernyataan berdasarkan teks/data yang diberikan.`,
    materialTopic: `Analisis tabel pernyataan ${subTestCode}`,
    optionA: 'Benar',
    optionB: 'Salah',
    optionC: statements[0] ?? null,
    optionD: statements[1] ?? null,
    optionE: statements[2] ?? null,
    correctAnswer: null,
    discussion: 'Periksa setiap pernyataan satu per satu terhadap data agar tidak sekadar menebak.',
    shortAnswerType: null,
    shortAnswerKey: null,
    shortAnswerTolerance: null,
    shortAnswerCaseSensitive: false,
    complexCorrectJson: {
      statements,
      labels: {
        left: 'Benar',
        right: 'Salah',
      },
      answers,
    },
    isMathContent: isQuantitativeSubTest(subTestCode),
  };
}

async function seedDummyQuestions() {
  const codes = Object.keys(dummyQuestionTargets);
  const subTestsInDb = await prisma.subTest.findMany({
    where: {
      code: {
        in: codes,
      },
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
  });

  if (subTestsInDb.length !== codes.length) {
    throw new Error('Sebagian sub-test target tidak ditemukan. Jalankan seed sub-test terlebih dahulu.');
  }

  const author = await ensureSeedQuestionAuthor();

  await prisma.question.deleteMany({
    where: {
      subTestId: {
        in: subTestsInDb.map((item) => item.id),
      },
    },
  });

  let createdCount = 0;
  for (const subTest of subTestsInDb) {
    const target = dummyQuestionTargets[subTest.code] ?? 0;
    for (let i = 0; i < target; i += 1) {
      const format = chooseQuestionFormat(i);
      const data =
        format === 'MULTIPLE_CHOICE_SINGLE'
          ? buildSingleChoiceQuestion(subTest.code, subTest.name, i)
          : format === 'SHORT_INPUT'
            ? buildShortInputQuestion(subTest.code, subTest.name, i)
            : buildComplexQuestion(subTest.code, subTest.name, i);

      await prisma.question.create({
        data: {
          subTestId: subTest.id,
          createdById: author.id,
          promptText: data.promptText,
          materialTopic: data.materialTopic,
          imageUrl: null,
          imageUrls: undefined,
          isMathContent: data.isMathContent,
          answerFormat: data.answerFormat as any,
          optionA: data.optionA,
          optionB: data.optionB,
          optionC: data.optionC,
          optionD: data.optionD,
          optionE: data.optionE,
          correctAnswer: data.correctAnswer as any,
          complexCorrectJson: data.complexCorrectJson as any,
          shortAnswerType: data.shortAnswerType as any,
          shortAnswerKey: data.shortAnswerKey,
          shortAnswerTolerance: data.shortAnswerTolerance,
          shortAnswerCaseSensitive: data.shortAnswerCaseSensitive,
          discussion: data.discussion,
          isActive: true,
        },
      });
      createdCount += 1;
    }
  }

  console.log(`Dummy questions seeded: ${createdCount}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed script cannot be run in production! This would delete all real exam questions.');
  }

  await seedSubTestsAndSchedule();
  await seedRolesAndPermissions();
  await seedDummyQuestions();

  const totalDuration = subTests.reduce((sum, item) => sum + item.durationSeconds, 0);
  if (totalDuration !== 11700) {
    throw new Error(`Invalid total duration: ${totalDuration} seconds (expected 11700).`);
  }

  console.log('Seeding completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
