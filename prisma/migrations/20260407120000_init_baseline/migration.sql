-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('TPS', 'LITERASI');

-- CreateEnum
CREATE TYPE "AnswerOption" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- CreateEnum
CREATE TYPE "QuestionAnswerFormat" AS ENUM ('MULTIPLE_CHOICE_SINGLE', 'SHORT_INPUT', 'MULTIPLE_CHOICE_COMPLEX');

-- CreateEnum
CREATE TYPE "ShortAnswerType" AS ENUM ('NUMERIC', 'TEXT');

-- CreateEnum
CREATE TYPE "ExamSessionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SectionProgressStatus" AS ENUM ('LOCKED', 'ACTIVE', 'COMPLETED', 'SKIPPED_BY_TIMEOUT');

-- CreateEnum
CREATE TYPE "ProctoringEventType" AS ENUM ('TAB_HIDDEN', 'WINDOW_BLUR', 'WINDOW_FOCUS', 'FORCE_SUBMIT_TRIGGERED');

-- CreateEnum
CREATE TYPE "UserRoleCode" AS ENUM ('MASTER_ADMIN', 'ADMIN', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "PermissionScopeType" AS ENUM ('GLOBAL', 'SUB_TEST');

-- CreateEnum
CREATE TYPE "AccessActionType" AS ENUM ('ROLE_ASSIGNED', 'ROLE_REVOKED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'USER_LOCKED', 'USER_UNLOCKED');

-- CreateEnum
CREATE TYPE "PermissionCode" AS ENUM ('QUESTION_CREATE', 'QUESTION_UPDATE', 'QUESTION_DELETE', 'QUESTION_VIEW_DRAFT', 'QUESTION_PUBLISH', 'QUESTION_REVIEW', 'SUBTEST_VIEW', 'EXAM_RESULT_VIEW', 'EXAM_RESULT_EXPORT', 'USER_VIEW', 'USER_SUSPEND', 'ADMIN_ROLE_ASSIGN', 'ADMIN_ROLE_REVOKE', 'ADMIN_PERMISSION_GRANT', 'ADMIN_PERMISSION_REVOKE', 'AUDIT_LOG_VIEW');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantAccessToken" (
    "id" TEXT NOT NULL,
    "tokenKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "userId" TEXT NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByIp" TEXT,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ParticipantAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "component" "ComponentType" NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "subTestId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "materialTopic" TEXT,
    "imageUrl" TEXT,
    "imageUrls" JSONB,
    "isMathContent" BOOLEAN NOT NULL DEFAULT false,
    "answerFormat" "QuestionAnswerFormat" NOT NULL DEFAULT 'MULTIPLE_CHOICE_SINGLE',
    "optionA" TEXT,
    "optionB" TEXT,
    "optionC" TEXT,
    "optionD" TEXT,
    "optionE" TEXT,
    "correctAnswer" "AnswerOption",
    "complexCorrectJson" JSONB,
    "shortAnswerType" "ShortAnswerType",
    "shortAnswerKey" TEXT,
    "shortAnswerTolerance" DOUBLE PRECISION,
    "shortAnswerCaseSensitive" BOOLEAN DEFAULT false,
    "discussion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantAccessTokenId" TEXT,
    "currentQuestionId" TEXT,
    "participantName" TEXT,
    "participantCongregation" TEXT,
    "participantSchool" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "status" "ExamSessionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "totalDurationSeconds" INTEGER NOT NULL DEFAULT 11700,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "forceSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "currentSectionOrder" INTEGER NOT NULL DEFAULT 1,
    "scoreSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedAnswer" "AnswerOption",
    "shortAnswerText" TEXT,
    "selectedAnswersJson" JSONB,
    "isCorrect" BOOLEAN,
    "answeredAt" TIMESTAMP(3),
    "timeSpentSeconds" INTEGER,
    "discussionSnapshot" TEXT,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionSchedule" (
    "id" TEXT NOT NULL,
    "subTestId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "label" TEXT,
    "isLockedNavigation" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SectionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSectionProgress" (
    "id" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "sectionScheduleId" TEXT NOT NULL,
    "status" "SectionProgressStatus" NOT NULL DEFAULT 'LOCKED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "remainingSecondsAtLastSync" INTEGER NOT NULL,
    "autoAdvanced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SessionSectionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctoringEvent" (
    "id" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "eventType" "ProctoringEventType" NOT NULL,
    "warningNumber" INTEGER,
    "metadataJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" "UserRoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" "PermissionCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "scopeType" "PermissionScopeType" NOT NULL,
    "subTestId" TEXT,
    "grantedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserPermissionScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actionType" "AccessActionType" NOT NULL,
    "targetUserId" TEXT,
    "targetRoleCode" "UserRoleCode",
    "targetPermissionCode" "PermissionCode",
    "scopeType" "PermissionScopeType",
    "subTestId" TEXT,
    "reason" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantAccessToken_tokenKey_key" ON "ParticipantAccessToken"("tokenKey");

-- CreateIndex
CREATE INDEX "ParticipantAccessToken_userId_revokedAt_idx" ON "ParticipantAccessToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ParticipantAccessToken_generatedByUserId_createdAt_idx" ON "ParticipantAccessToken"("generatedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubTest_code_key" ON "SubTest"("code");

-- CreateIndex
CREATE INDEX "SubTest_component_idx" ON "SubTest"("component");

-- CreateIndex
CREATE INDEX "SubTest_orderIndex_idx" ON "SubTest"("orderIndex");

-- CreateIndex
CREATE INDEX "Question_subTestId_idx" ON "Question"("subTestId");

-- CreateIndex
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");

-- CreateIndex
CREATE INDEX "ExamSession_userId_status_idx" ON "ExamSession"("userId", "status");

-- CreateIndex
CREATE INDEX "ExamSession_participantAccessTokenId_idx" ON "ExamSession"("participantAccessTokenId");

-- CreateIndex
CREATE INDEX "ExamSession_createdAt_idx" ON "ExamSession"("createdAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_examSessionId_idx" ON "ExamAttempt"("examSessionId");

-- CreateIndex
CREATE INDEX "ExamAttempt_questionId_idx" ON "ExamAttempt"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_examSessionId_questionId_key" ON "ExamAttempt"("examSessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSchedule_subTestId_key" ON "SectionSchedule"("subTestId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSchedule_orderIndex_key" ON "SectionSchedule"("orderIndex");

-- CreateIndex
CREATE INDEX "SectionSchedule_isActive_idx" ON "SectionSchedule"("isActive");

-- CreateIndex
CREATE INDEX "SessionSectionProgress_examSessionId_status_idx" ON "SessionSectionProgress"("examSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionSectionProgress_examSessionId_sectionScheduleId_key" ON "SessionSectionProgress"("examSessionId", "sectionScheduleId");

-- CreateIndex
CREATE INDEX "ProctoringEvent_examSessionId_occurredAt_idx" ON "ProctoringEvent"("examSessionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserRole_userId_revokedAt_idx" ON "UserRole"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserRole_roleId_revokedAt_idx" ON "UserRole"("roleId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserPermissionScope_userId_permissionId_revokedAt_idx" ON "UserPermissionScope"("userId", "permissionId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserPermissionScope_scopeType_subTestId_idx" ON "UserPermissionScope"("scopeType", "subTestId");

-- CreateIndex
CREATE INDEX "AccessAuditLog_actorUserId_occurredAt_idx" ON "AccessAuditLog"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AccessAuditLog_targetUserId_occurredAt_idx" ON "AccessAuditLog"("targetUserId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ParticipantAccessToken" ADD CONSTRAINT "ParticipantAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantAccessToken" ADD CONSTRAINT "ParticipantAccessToken_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subTestId_fkey" FOREIGN KEY ("subTestId") REFERENCES "SubTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_participantAccessTokenId_fkey" FOREIGN KEY ("participantAccessTokenId") REFERENCES "ParticipantAccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSchedule" ADD CONSTRAINT "SectionSchedule_subTestId_fkey" FOREIGN KEY ("subTestId") REFERENCES "SubTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSectionProgress" ADD CONSTRAINT "SessionSectionProgress_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSectionProgress" ADD CONSTRAINT "SessionSectionProgress_sectionScheduleId_fkey" FOREIGN KEY ("sectionScheduleId") REFERENCES "SectionSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctoringEvent" ADD CONSTRAINT "ProctoringEvent_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionScope" ADD CONSTRAINT "UserPermissionScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionScope" ADD CONSTRAINT "UserPermissionScope_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionScope" ADD CONSTRAINT "UserPermissionScope_subTestId_fkey" FOREIGN KEY ("subTestId") REFERENCES "SubTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionScope" ADD CONSTRAINT "UserPermissionScope_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAuditLog" ADD CONSTRAINT "AccessAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAuditLog" ADD CONSTRAINT "AccessAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAuditLog" ADD CONSTRAINT "AccessAuditLog_subTestId_fkey" FOREIGN KEY ("subTestId") REFERENCES "SubTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

