/* eslint-disable no-console */

const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3001';

function randomEmail() {
  return `smoke-${Date.now()}-${Math.floor(Math.random() * 10000)}@local.test`;
}

async function postJson(path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`POST ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function main() {
  const fullName = process.env.SMOKE_FULL_NAME || 'Smoke User';
  const email = process.env.SMOKE_EMAIL || randomEmail();
  const password = process.env.SMOKE_PASSWORD || 'SmokePass123!';

  console.log(`[smoke] baseUrl=${baseUrl}`);
  console.log(`[smoke] register/login with ${email}`);

  await postJson('/auth/register', { fullName, email, password });
  const login = await postJson('/auth/login', { email, password });

  const accessToken = login?.accessToken;
  if (!accessToken) {
    throw new Error('No accessToken in login response.');
  }

  const start = await postJson('/exam/start-session', {}, accessToken);
  const examSessionId = start?.examSessionId;
  if (!examSessionId) {
    throw new Error('No examSessionId in start-session response.');
  }

  await postJson('/exam/section-questions', { examSessionId }, accessToken);
  await postJson('/exam/submit-final', { examSessionId }, accessToken);

  const insight = await postJson('/ai/insight', { examSessionId }, accessToken);
  console.log(`[smoke] done: session=${examSessionId}, insightSource=${insight?.source || 'unknown'}`);
}

main().catch((error) => {
  console.error('[smoke] failed:', error.message);
  process.exit(1);
});
