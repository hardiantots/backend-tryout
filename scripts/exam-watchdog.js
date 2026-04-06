/* eslint-disable no-console */

const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const crypto = require('crypto');

const prisma = new PrismaClient();

const BASE_URL = process.env.WATCHDOG_BASE_URL || process.env.SMOKE_BASE_URL || 'http://localhost:3001';
const MODE = (process.env.WATCHDOG_MODE || 'watch').toLowerCase(); // watch | quick
const DURATION_MINUTES = Number(process.env.WATCHDOG_DURATION_MINUTES || 190);
const CHECK_INTERVAL_SECONDS = Number(process.env.WATCHDOG_INTERVAL_SECONDS || 30);

function nowIso() {
  return new Date().toISOString();
}

function log(step, detail) {
  console.log(`[watchdog][${nowIso()}][${step}] ${detail}`);
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(`${path} failed (${res.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function postExpectFail(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    throw new Error(`${path} expected failure but got success: ${JSON.stringify(payload)}`);
  }

  return res.status;
}

async function createParticipantWithToken() {
  const email = `watchdog.participant.${Date.now()}@snbt.local`;
  const passwordHash = await argon2.hash('WatchdogParticipant123!');

  const user = await prisma.user.create({
    data: {
      fullName: 'Watchdog Participant',
      email,
      passwordHash,
      isEmailVerified: true,
    },
  });

  const participantRole = await prisma.role.findUnique({ where: { code: 'PARTICIPANT' } });
  assertCondition(Boolean(participantRole), 'PARTICIPANT role not found. Run seed first.');

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: participantRole.id,
      assignedByUserId: user.id,
    },
  });

  const tokenKey = crypto.randomBytes(4).toString('hex').toUpperCase();
  const rawToken = `PTK-${tokenKey}-${crypto.randomBytes(18).toString('base64url')}`;

  await prisma.participantAccessToken.create({
    data: {
      tokenKey,
      tokenHash: await argon2.hash(rawToken),
      userId: user.id,
      generatedByUserId: user.id,
      label: 'watchdog-generated',
    },
  });

  return { userId: user.id, token: rawToken };
}

async function loginParticipant(rawToken) {
  const payload = await postJson('/auth/participant-token-login', { token: rawToken });
  assertCondition(Boolean(payload?.accessToken), 'No accessToken from participant login');
  return payload.accessToken;
}

async function startSession(accessToken, profileSuffix) {
  const payload = await postJson(
    '/exam/start-session',
    {
      fullName: `Watchdog User ${profileSuffix}`,
      congregation: `Congregation ${profileSuffix}`,
      schoolName: `School ${profileSuffix}`,
      agreedToTerms: true,
    },
    accessToken,
  );

  assertCondition(Boolean(payload?.examSessionId), 'No examSessionId from start-session');
  return payload;
}

async function submitAnyAnswer(accessToken, examSessionId, question) {
  if (!question) {
    return;
  }

  if (question.answerFormat === 'MULTIPLE_CHOICE_SINGLE') {
    await postJson('/exam/submit-attempt', {
      examSessionId,
      questionId: question.id,
      selectedAnswer: 'A',
    }, accessToken);
    return;
  }

  if (question.answerFormat === 'SHORT_INPUT') {
    await postJson('/exam/submit-attempt', {
      examSessionId,
      questionId: question.id,
      shortAnswerText: question.shortAnswerType === 'NUMERIC' ? '1' : 'uji',
    }, accessToken);
    return;
  }

  const rows = Array.isArray(question.complexStatements) ? question.complexStatements.length : 3;
  const selectedAnswers = Array.from({ length: Math.max(3, rows) }, () => 'LEFT');
  await postJson('/exam/submit-attempt', {
    examSessionId,
    questionId: question.id,
    selectedAnswers,
  }, accessToken);
}

async function verifySectionLock(accessToken, examSessionId, activeSectionCode) {
  const offSectionQuestion = await prisma.question.findFirst({
    where: {
      isActive: true,
      subTest: {
        code: {
          not: activeSectionCode,
        },
      },
    },
    select: { id: true },
  });

  if (!offSectionQuestion) {
    return;
  }

  const status = await postExpectFail('/exam/submit-attempt', {
    examSessionId,
    questionId: offSectionQuestion.id,
    selectedAnswer: 'A',
  }, accessToken);

  assertCondition(status === 403, `Section lock expected 403, got ${status}`);
}

async function transitionSweep(accessToken, examSessionId) {
  log('transition', 'Starting transition sweep across all sections');

  let previousOrder = null;
  let safety = 0;
  while (safety < 20) {
    safety += 1;
    const active = await postJson('/exam/active-section', { examSessionId }, accessToken);

    if (active?.isFinished) {
      log('transition', 'Reached finished state in transition sweep');
      return;
    }

    const order = active?.activeSection?.order;
    assertCondition(typeof order === 'number', 'activeSection.order missing during transition sweep');

    if (previousOrder != null) {
      assertCondition(order === previousOrder || order === previousOrder + 1, `Section order jump detected: ${previousOrder} -> ${order}`);
    }

    const hb = await postJson('/exam/heartbeat', {
      examSessionId,
      sectionOrder: order,
      clientRemainingSeconds: 0,
    }, accessToken);

    if (hb?.isFinished) {
      log('transition', 'Transition sweep completed all sections');
      return;
    }

    assertCondition(hb?.activeSectionOrder === order + 1, `Expected next section ${order + 1}, got ${hb?.activeSectionOrder}`);
    previousOrder = hb.activeSectionOrder;
  }

  throw new Error('Transition sweep safety limit reached');
}

async function monitoringLoop(accessToken, examSessionId, durationMs, intervalMs) {
  const started = Date.now();
  let cycle = 0;

  while (Date.now() - started < durationMs) {
    cycle += 1;

    const active = await postJson('/exam/active-section', { examSessionId }, accessToken);
    if (active?.isFinished) {
      throw new Error('Session finished unexpectedly during watchdog window');
    }

    const sectionOrder = active?.activeSection?.order;
    const sectionCode = active?.activeSection?.code;
    assertCondition(typeof sectionOrder === 'number', 'Missing section order');
    assertCondition(Boolean(sectionCode), 'Missing section code');

    const questionsPayload = await postJson('/exam/section-questions', { examSessionId }, accessToken);
    const questions = questionsPayload?.questions || [];
    assertCondition(Array.isArray(questions), 'Questions payload is invalid');
    assertCondition(questions.length > 0, 'No questions in active section');

    const target = questions[cycle % questions.length];
    await submitAnyAnswer(accessToken, examSessionId, target);

    const reloaded = await postJson('/exam/section-questions', { examSessionId }, accessToken);
    const reloadedQuestion = (reloaded?.questions || []).find((q) => q.id === target.id);
    assertCondition(Boolean(reloadedQuestion?.savedAnswer), `Answer was not persisted for question ${target.id}`);

    await postJson('/exam/active-question', {
      examSessionId,
      questionId: target.id,
    }, accessToken);

    const activeAfterMark = await postJson('/exam/active-section', { examSessionId }, accessToken);
    assertCondition(activeAfterMark?.activeQuestionId === target.id, 'Active question marker not persisted');

    await verifySectionLock(accessToken, examSessionId, sectionCode);

    await postJson('/exam/heartbeat', {
      examSessionId,
      sectionOrder,
      clientRemainingSeconds: Math.max(1, Number(active?.activeSection?.serverRemainingSeconds ?? 60) - 1),
    }, accessToken);

    log('monitor', `cycle=${cycle} section=${sectionOrder} question=${target.id} OK`);
    await delay(intervalMs);
  }

  log('monitor', `Completed monitoring window: ${Math.round(durationMs / 60000)} minutes`);
}

async function main() {
  log('start', `baseUrl=${BASE_URL} mode=${MODE}`);

  const participant = await createParticipantWithToken();
  const accessToken = await loginParticipant(participant.token);

  // Phase A: fast transition verification to ensure no section skipping/locking regressions.
  const transitionSession = await startSession(accessToken, 'transition');
  await transitionSweep(accessToken, transitionSession.examSessionId);
  await postJson('/exam/submit-final', { examSessionId: transitionSession.examSessionId }, accessToken);

  // Phase B: long-running watchdog monitoring with an active in-progress session.
  const monitorSession = await startSession(accessToken, 'monitor');
  const durationMs = MODE === 'quick' ? 2 * 60 * 1000 : DURATION_MINUTES * 60 * 1000;
  const intervalMs = MODE === 'quick' ? 5000 : CHECK_INTERVAL_SECONDS * 1000;

  await monitoringLoop(accessToken, monitorSession.examSessionId, durationMs, intervalMs);

  log('done', 'Exam watchdog completed without critical findings');
}

main()
  .catch((error) => {
    console.error(`[watchdog][${nowIso()}][failed]`, error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
